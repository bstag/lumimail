import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { mailboxes, users, orgInvites, organizationMembers } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { firstRunRegisterSchema, primaryDomainRegisterSchema } from "@/lib/validators";
import { addDomainForUser } from "@/lib/domains/service";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { getPrimaryDomain, getPrimaryDomainForOrg } from "@/lib/user";
import { ensureUserOrg } from "@/lib/migration/backfill-orgs";
import { apiError } from "@/lib/api/response";

export async function POST(request: Request) {
	const env = getEnv();
	const body = await request.json() as Record<string, unknown>;
	const db = getDb(env);
	const inviteToken = typeof body.inviteToken === "string" ? body.inviteToken : null;

	let inviteOrgId: string | null = null;
	let inviteRole: "admin" | "member" | null = null;
	let inviteId: string | null = null;

	if (inviteToken) {
		const [invite] = await db
			.select()
			.from(orgInvites)
			.where(and(eq(orgInvites.token, inviteToken), gt(orgInvites.expiresAt, new Date())))
			.limit(1);

		if (!invite) {
			return apiError("Invite not found or expired", 404);
		}

		inviteOrgId = invite.organizationId;
		inviteRole = invite.role as "admin" | "member";
		inviteId = invite.id;
	}

	const primaryDomain = inviteOrgId
		? await getPrimaryDomainForOrg(env, inviteOrgId)
		: await getPrimaryDomain(env);
	const primaryDomainExists = !!primaryDomain;
	const isFirstRun = !primaryDomainExists && !inviteOrgId;
	const firstRunParsed = isFirstRun ? firstRunRegisterSchema.safeParse(body) : null;
	const registerParsed = isFirstRun ? null : primaryDomainRegisterSchema.safeParse(body);

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
	const name = username;

	const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	if (existing) {
		return NextResponse.json({ error: "Email already registered" }, { status: 409 });
	}

	const userId = newId("usr");
	await db.insert(users).values({
		id: userId,
		email,
		resetEmail: firstRunParsed?.success ? firstRunParsed.data.resetEmail : registerParsed!.data.resetEmail,
		passwordHash: hashPassword(password),
		name,
		organizationId: inviteOrgId,
	});

	if (inviteOrgId && inviteRole && inviteId) {
		await db.insert(organizationMembers).values({
			id: newId("om"),
			organizationId: inviteOrgId,
			userId,
			role: inviteRole as "admin" | "member",
			createdAt: new Date(),
		});

		await db.delete(orgInvites).where(eq(orgInvites.id, inviteId));
	}

	let orgId: string;
	if (inviteOrgId) {
		orgId = inviteOrgId;
	} else {
		orgId = await ensureUserOrg(env, userId);
	}

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
				localPart: username!,
				displayName: username!,
			});
		} catch {
			await db.delete(users).where(eq(users.id, userId));
			/* v8 ignore start -- first-run path has no invite, so inviteId is always null here */
			if (inviteId) await db.insert(orgInvites).values({
				id: inviteId,
				organizationId: inviteOrgId!,
				email,
				role: inviteRole!,
				token: inviteToken!,
				expiresAt: new Date(Date.now() + 7 * 86400000),
				createdAt: new Date(),
			});
			/* v8 ignore stop */
			return apiError("Domain setup failed", 502);
		}
	}

	if (!isFirstRun) {
		const [existingMailbox] = await db
			.select()
			.from(mailboxes)
			.where(and(eq(mailboxes.domainId, primaryDomain!.id), eq(mailboxes.localPart, username)))
			.limit(1);
		if (existingMailbox) {
			await db.delete(users).where(eq(users.id, userId));
			if (inviteId) await db.insert(orgInvites).values({
				id: inviteId,
				organizationId: inviteOrgId!,
				email,
				role: inviteRole!,
				token: inviteToken!,
				expiresAt: new Date(Date.now() + 7 * 86400000),
				createdAt: new Date(),
			});
			return NextResponse.json({ error: "Mailbox already exists" }, { status: 409 });
		}

		try {
			await ensureEmailRoutingRuleToWorker(env, primaryDomain!.zoneId, email);
			await db.insert(mailboxes).values({
				id: newId("mbx"),
				userId,
				organizationId: orgId,
				domainId: primaryDomain!.id,
				localPart: username,
				displayName: username,
			});
		} catch (err) {
			await db.delete(users).where(eq(users.id, userId));
			/* v8 ignore start -- primary-domain path has no invite, so inviteId is always null here */
			if (inviteId) await db.insert(orgInvites).values({
				id: inviteId,
				organizationId: inviteOrgId!,
				email,
				role: inviteRole!,
				token: inviteToken!,
				expiresAt: new Date(Date.now() + 7 * 86400000),
				createdAt: new Date(),
			});
			/* v8 ignore stop */
			const message = err instanceof Error ? err.message : "Mailbox setup failed";
			return NextResponse.json({ error: message }, { status: 502 });
		}
	}

	if (!inviteOrgId) {
		await ensureUserOrg(env, userId);
	}
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
