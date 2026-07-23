import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { mailboxes, users, orgInvites, organizationMembers } from "@/db/schema";
import { hashInvitationToken } from "@/lib/auth/invitation";
import { hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import {
	firstRunRegisterSchema,
	inviteRegisterSchema,
	primaryDomainRegisterSchema,
} from "@/lib/validators";
import { addDomainForUser } from "@/lib/domains/service";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { getPrimaryDomain } from "@/lib/user";
import { ensureUserOrg } from "@/lib/migration/backfill-orgs";
import { apiError } from "@/lib/api/response";

async function authenticatedResponse(env: CloudflareEnv, userId: string) {
	const token = await createSession(env, userId);
	const response = NextResponse.json({ token, redirect: "/inbox" });
	response.cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 30,
	});
	return response;
}

async function registerFromInvite(
	env: CloudflareEnv,
	body: Record<string, unknown>,
	inviteToken: string,
) {
	const parsed = inviteRegisterSchema.safeParse(body);
	if (!parsed.success) return apiError("Invalid registration", 400);

	const db = getDb(env);
	const tokenHash = await hashInvitationToken(inviteToken);
	const [invite] = await db
		.select()
		.from(orgInvites)
		.where(and(eq(orgInvites.token, tokenHash), gt(orgInvites.expiresAt, new Date())))
		.limit(1);
	if (!invite) return apiError("Invite not found or expired", 404);

	const email = invite.email.trim().toLowerCase();
	const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
	if (existing) return apiError("Email already registered", 409);

	const userId = newId("usr");
	const userName = email.split("@")[0];
	const [claimedInvite] = await db
		.delete(orgInvites)
		.where(
			and(
				eq(orgInvites.id, invite.id),
				eq(orgInvites.token, tokenHash),
				gt(orgInvites.expiresAt, new Date()),
			),
		)
		.returning();
	if (!claimedInvite) return apiError("Invite not found or expired", 404);

	try {
		await db.batch([
			db.insert(users).values({
				id: userId,
				email,
				resetEmail: parsed.data.resetEmail,
				passwordHash: hashPassword(parsed.data.password),
				name: userName,
				organizationId: invite.organizationId,
			}),
			db.insert(organizationMembers).values({
				id: newId("om"),
				organizationId: invite.organizationId,
				userId,
				role: invite.role as "admin" | "member",
				createdAt: new Date(),
			}),
		]);
	} catch {
		await db
			.insert(orgInvites)
			.values({
				id: claimedInvite.id,
				organizationId: claimedInvite.organizationId,
				email: claimedInvite.email,
				role: claimedInvite.role,
				token: claimedInvite.token,
				expiresAt: claimedInvite.expiresAt,
				createdAt: claimedInvite.createdAt,
			})
			.onConflictDoNothing();
		return apiError("Unable to accept invitation", 503);
	}

	return authenticatedResponse(env, userId);
}

export async function POST(request: Request) {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object") return apiError("Invalid registration", 400);

	const record = body as Record<string, unknown>;
	const inviteToken = typeof record.inviteToken === "string" ? record.inviteToken.trim() : "";
	const env = getEnv();
	if (inviteToken) return registerFromInvite(env, record, inviteToken);

	const db = getDb(env);
	const primaryDomain = await getPrimaryDomain(env);
	const isFirstRun = !primaryDomain;
	const firstRunParsed = isFirstRun ? firstRunRegisterSchema.safeParse(record) : null;
	const registerParsed = isFirstRun ? null : primaryDomainRegisterSchema.safeParse(record);

	if (firstRunParsed && !firstRunParsed.success) {
		return NextResponse.json({ error: firstRunParsed.error.flatten() }, { status: 400 });
	}
	if (registerParsed && !registerParsed.success) {
		return NextResponse.json({ error: registerParsed.error.flatten() }, { status: 400 });
	}

	const domainName = firstRunParsed?.success ? firstRunParsed.data.domain.toLowerCase().trim() : null;
	const username = (firstRunParsed?.success ? firstRunParsed.data.username : registerParsed!.data.username)
		.toLowerCase()
		.trim();
	const email = firstRunParsed?.success
		? `${username}@${domainName}`
		: `${username}@${primaryDomain!.hostname}`;
	const password = firstRunParsed?.success ? firstRunParsed.data.password : registerParsed!.data.password;
	const resetEmail = firstRunParsed?.success
		? firstRunParsed.data.resetEmail
		: registerParsed!.data.resetEmail;

	const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	if (existing) {
		return NextResponse.json({ error: "Email already registered" }, { status: 409 });
	}

	const userId = newId("usr");
	await db.insert(users).values({
		id: userId,
		email,
		resetEmail,
		passwordHash: hashPassword(password),
		name: username,
		organizationId: null,
	});
	const orgId = await ensureUserOrg(env, userId);

	if (isFirstRun) {
		try {
			const { domain } = await addDomainForUser(env, userId, orgId, domainName!, {
				enableRouting: true,
				enableSending: true,
			});
			await ensureEmailRoutingRuleToWorker(env, domain.zoneId, email);
			await db.insert(mailboxes).values({
				id: newId("mbx"),
				userId,
				organizationId: orgId,
				domainId: domain.id,
				localPart: username,
				displayName: username,
			});
		} catch {
			await db.delete(users).where(eq(users.id, userId));
			return apiError("Domain setup failed", 502);
		}
	} else {
		const [existingMailbox] = await db
			.select()
			.from(mailboxes)
			.where(and(eq(mailboxes.domainId, primaryDomain.id), eq(mailboxes.localPart, username)))
			.limit(1);
		if (existingMailbox) {
			await db.delete(users).where(eq(users.id, userId));
			return NextResponse.json({ error: "Mailbox already exists" }, { status: 409 });
		}

		try {
			await ensureEmailRoutingRuleToWorker(env, primaryDomain.zoneId, email);
			await db.insert(mailboxes).values({
				id: newId("mbx"),
				userId,
				organizationId: orgId,
				domainId: primaryDomain.id,
				localPart: username,
				displayName: username,
			});
		} catch (err) {
			await db.delete(users).where(eq(users.id, userId));
			const message = err instanceof Error ? err.message : "Mailbox setup failed";
			return NextResponse.json({ error: message }, { status: 502 });
		}
	}

	return authenticatedResponse(env, userId);
}
