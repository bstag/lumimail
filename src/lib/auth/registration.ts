import { and, eq, gt } from "drizzle-orm";
import type { z } from "zod";
import { getDb } from "@/db";
import { mailboxes, users, orgInvites, organizationMembers } from "@/db/schema";
import { hashInvitationToken } from "@/lib/auth/invitation";
import { hashPassword } from "@/lib/auth/password";
import { newId } from "@/lib/ids";
import type { firstRunRegisterSchema, inviteRegisterSchema } from "@/lib/validators";
import { addDomainForUser } from "@/lib/domains/service";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { ensureUserOrg } from "@/lib/migration/backfill-orgs";

/**
 * Registration service (T-40), modeled on `src/lib/domains/service.ts`.
 *
 * The register route has two multi-step flows whose failure handling is
 * compensation, not just error mapping:
 *
 *  - Invite claim: the invite row is atomically consumed (delete-returning)
 *    before the user + membership batch is written; if that batch fails the
 *    claimed invite is inserted back so the invitation link keeps working.
 *  - First-run: the very first user is created, then domain provisioning /
 *    routing / mailbox creation run; any failure deletes the just-created user
 *    so a retry does not hit "Email already registered" for an account that
 *    never finished setup.
 *
 * Both flows return typed results; the route maps them onto its exact
 * (pre-extraction, byte-identical) response bodies and statuses.
 */

export type InviteRegistrationInput = z.infer<typeof inviteRegisterSchema>;

export type InviteRegistrationResult =
	| { ok: true; userId: string }
	| { ok: false; error: "invite_not_found" | "email_taken" | "claim_conflict" | "unavailable" };

export async function registerFromInvite(
	env: CloudflareEnv,
	input: InviteRegistrationInput,
): Promise<InviteRegistrationResult> {
	const db = getDb(env);
	const tokenHash = await hashInvitationToken(input.inviteToken);
	const [invite] = await db
		.select()
		.from(orgInvites)
		.where(and(eq(orgInvites.token, tokenHash), gt(orgInvites.expiresAt, new Date())))
		.limit(1);
	if (!invite) return { ok: false, error: "invite_not_found" };

	const email = invite.email.trim().toLowerCase();
	const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
	if (existing) return { ok: false, error: "email_taken" };

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
	if (!claimedInvite) return { ok: false, error: "claim_conflict" };

	try {
		await db.batch([
			db.insert(users).values({
				id: userId,
				email,
				resetEmail: input.resetEmail,
				passwordHash: hashPassword(input.password),
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
		// Compensation: the invite was already consumed, so put it back (idempotent
		// under a concurrent successful claim) rather than burning the invitation.
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
		return { ok: false, error: "unavailable" };
	}

	return { ok: true, userId };
}

export type FirstRunRegistrationInput = z.infer<typeof firstRunRegisterSchema>;

export type FirstRunRegistrationResult =
	| { ok: true; userId: string }
	| { ok: false; error: "email_taken" | "domain_setup_failed" };

export async function registerFirstRunUser(
	env: CloudflareEnv,
	input: FirstRunRegistrationInput,
): Promise<FirstRunRegistrationResult> {
	const db = getDb(env);
	const domainName = input.domain.toLowerCase().trim();
	const username = input.username.toLowerCase().trim();
	const email = `${username}@${domainName}`;

	const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	if (existing) return { ok: false, error: "email_taken" };

	const userId = newId("usr");
	await db.insert(users).values({
		id: userId,
		email,
		resetEmail: input.resetEmail,
		passwordHash: hashPassword(input.password),
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
		// Rollback: without the domain/mailbox the account is unusable, so delete
		// the user rather than stranding a half-provisioned first account.
		await db.delete(users).where(eq(users.id, userId));
		return { ok: false, error: "domain_setup_failed" };
	}

	return { ok: true, userId };
}
