import { eq, and, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxMemberships, mailboxes, organizationMembers, users } from "@/db/schema";
import { parseAddress } from "@/lib/utils";
import { SENDER_ROLES } from "@/lib/constants";

async function getUserOrgId(env: CloudflareEnv, userId: string): Promise<string | null | undefined> {
	const db = getDb(env);
	const [user] = await db
		.select({
			organizationId: users.organizationId,
			memberOrganizationId: organizationMembers.organizationId,
		})
		.from(users)
		.leftJoin(organizationMembers, and(
			eq(organizationMembers.userId, users.id),
			eq(organizationMembers.organizationId, users.organizationId),
		))
		.where(eq(users.id, userId))
		.limit(1);
	if (!user) return undefined;
	// `users.organizationId` is an active-workspace pointer, while the join
	// table is the membership truth. A stale pointer must not authorize an
	// organization mailbox. A null pointer is the supported personal-account
	// state and needs no membership row.
	if (user.organizationId && user.memberOrganizationId !== user.organizationId) return undefined;
	return user.organizationId;
}

/**
 * The authorized sender identity. Carries the full mailbox identity row
 * (local part, hostname, display name) so callers can derive the canonical
 * From header without re-querying the mailbox (T-30 merged the previous
 * duplicated sender-context lookup into this result).
 */
export type SenderAuthorization = {
	mailboxId: string;
	organizationId: string | null;
	localPart: string;
	hostname: string;
	displayName: string | null;
};

export class SenderNotAllowedError extends Error {
	constructor(from: string) {
		super(`Sender address is not an active mailbox for your account: ${from}`);
		this.name = "SenderNotAllowedError";
	}
}

/**
 * Resolves whether `from` is an active mailbox the user may send as.
 *
 * Pure DB check (T-31): send-time authorization no longer provisions the
 * Cloudflare Email Routing rule lazily. Rules are created when the mailbox is
 * created (mailboxes POST, first-run registration) or when an alias is
 * provisioned; pre-existing drift is repaired via the reconcile paths, not
 * silently at send time.
 */
export async function resolveSenderAuthorization(
	env: CloudflareEnv,
	userId: string,
	from: string,
	mailboxId?: string,
): Promise<SenderAuthorization | null> {
	const parsed = parseAddress(from);
	if (!parsed) return null;
	const db = getDb(env);
	const orgId = await getUserOrgId(env, userId);
	// A missing identity is not a legacy personal account. Treat it as
	// unauthorized rather than allowing an orphaned mailbox-owner fallback.
	if (orgId === undefined) return null;
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(
			eq(domains.hostname, parsed.domain),
			eq(domains.status, "active"),
			orgId ? eq(domains.organizationId, orgId) : isNull(domains.organizationId),
		))
		.limit(1);
	if (!domain) return null;

	const baseConditions = [
		eq(mailboxes.domainId, domain.id),
		eq(mailboxes.localPart, parsed.local),
		...(mailboxId ? [eq(mailboxes.id, mailboxId)] : []),
	];
	const mailboxQuery = db
		.select({
			id: mailboxes.id,
			organizationId: mailboxes.organizationId,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
		})
		.from(mailboxes);
	const [mailbox] = orgId
		? await mailboxQuery
			.innerJoin(mailboxMemberships, eq(mailboxMemberships.mailboxId, mailboxes.id))
			.where(and(
				...baseConditions,
				eq(mailboxes.organizationId, orgId),
				eq(mailboxMemberships.userId, userId),
				inArray(mailboxMemberships.role, SENDER_ROLES),
			))
			.limit(1)
		: await mailboxQuery
			.where(and(
				...baseConditions,
				eq(mailboxes.userId, userId),
				isNull(mailboxes.organizationId),
			))
			.limit(1);

	if (!mailbox) return null;
	return {
		mailboxId: mailbox.id,
		organizationId: mailbox.organizationId ?? orgId,
		localPart: mailbox.localPart,
		hostname: domain.hostname,
		displayName: mailbox.displayName,
	};
}

export async function validateSenderDomain(
	env: CloudflareEnv,
	userId: string,
	from: string,
	mailboxId?: string,
): Promise<boolean> {
	return !!await resolveSenderAuthorization(env, userId, from, mailboxId);
}
