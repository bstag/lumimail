import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { mailboxes, users, orgInvites, organizationMembers } from "@/db/schema";
import { hashInvitationToken } from "@/lib/auth/invitation";
import { hashPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import {
	firstRunRegisterSchema,
	inviteRegisterSchema,
} from "@/lib/validators";
import { addDomainForUser } from "@/lib/domains/service";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { getPrimaryDomain } from "@/lib/user";
import { ensureUserOrg } from "@/lib/migration/backfill-orgs";
import { apiError } from "@/lib/api/response";
import { enforceRateLimit, rateLimitIp } from "@/lib/rate-limit";

async function authenticatedResponse(env: CloudflareEnv, userId: string) {
	const token = await createSession(env, userId);
	const response = NextResponse.json({ redirect: "/inbox" });
	setSessionCookie(response, token);
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
	const env = getEnv();
	const limited = await enforceRateLimit(rateLimitIp(env, request, "register", 5, 60_000), {
		unavailableLog: "Registration rate limit unavailable",
		limitedMessage: "Too many attempts",
		respond: apiError,
	});
	if (limited) return limited;
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object") return apiError("Invalid registration", 400);

	const record = body as Record<string, unknown>;
	const inviteToken = typeof record.inviteToken === "string" ? record.inviteToken.trim() : "";
	if (inviteToken) return registerFromInvite(env, record, inviteToken);

	const db = getDb(env);
	const primaryDomain = await getPrimaryDomain(env);
	if (primaryDomain) return apiError("Registration requires an invitation", 403);
	const firstRunParsed = firstRunRegisterSchema.safeParse(record);

	if (!firstRunParsed.success) {
		return NextResponse.json({ error: firstRunParsed.error.flatten() }, { status: 400 });
	}

	const domainName = firstRunParsed.data.domain.toLowerCase().trim();
	const username = firstRunParsed.data.username.toLowerCase().trim();
	const email = `${username}@${domainName}`;
	const password = firstRunParsed.data.password;
	const resetEmail = firstRunParsed.data.resetEmail;

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

	try {
		const { domain } = await addDomainForUser(env, userId, orgId, domainName, {
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

	return authenticatedResponse(env, userId);
}
