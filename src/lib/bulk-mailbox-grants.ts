import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxMemberships, mailboxes, organizationMembers, securityAuditEvents } from "@/db/schema";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import type { MailboxRole } from "@/lib/constants";
import { newId } from "@/lib/ids";

type BulkMailboxGrantArgs = {
	organizationId: string;
	actorUserId: string;
	currentToken: string | undefined;
	targetUserId: string;
	mailboxIds: string[];
	role: MailboxRole;
	requestId: string;
	now?: Date;
};

export type BulkMailboxGrantResult =
	| { status: "recent-auth-required" }
	| { status: "not-found" }
	| { status: "granted"; createdCount: number; requestId: string };

export async function grantMailboxAccessBulk(
	env: CloudflareEnv,
	args: BulkMailboxGrantArgs,
): Promise<BulkMailboxGrantResult> {
	const now = args.now ?? new Date();
	const current = await readRecentlyAuthenticatedSession(
		env,
		args.actorUserId,
		args.currentToken,
		now,
	);
	if (current?.organizationId !== args.organizationId) return { status: "recent-auth-required" };

	const db = getDb(env);
	const [member] = await db
		.select({ userId: organizationMembers.userId })
		.from(organizationMembers)
		.where(and(
			eq(organizationMembers.organizationId, args.organizationId),
			eq(organizationMembers.userId, args.targetUserId),
		))
		.limit(1);
	if (!member) return { status: "not-found" };

	const mailboxRows = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(and(
			eq(mailboxes.organizationId, args.organizationId),
			inArray(mailboxes.id, args.mailboxIds),
		));
	const scopedMailboxIds = new Set(mailboxRows.map((mailbox) => mailbox.id));
	if (scopedMailboxIds.size !== args.mailboxIds.length) return { status: "not-found" };

	const existingRows = await db
		.select({ mailboxId: mailboxMemberships.mailboxId })
		.from(mailboxMemberships)
		.where(and(
			eq(mailboxMemberships.userId, args.targetUserId),
			inArray(mailboxMemberships.mailboxId, args.mailboxIds),
		));
	const existingMailboxIds = new Set(existingRows.map((membership) => membership.mailboxId));
	const missingMailboxIds = args.mailboxIds.filter((mailboxId) => !existingMailboxIds.has(mailboxId));

	const membershipInserts = missingMailboxIds.map((mailboxId) => db
		.insert(mailboxMemberships)
		.values({
			id: newId("mbm"),
			mailboxId,
			userId: args.targetUserId,
			role: args.role,
			createdAt: now,
			updatedAt: now,
		}));
	const auditInsert = db.insert(securityAuditEvents).values({
		id: newId("aud"),
		organizationId: args.organizationId,
		actorUserId: args.actorUserId,
		action: "mailbox.grant_bulk",
		resourceType: "mailbox_membership",
		resourceId: args.targetUserId,
		affectedCount: missingMailboxIds.length,
		requestId: args.requestId,
		outcome: "succeeded",
		createdAt: now,
	});
	await db.batch([auditInsert, ...membershipInserts]);

	return {
		status: "granted",
		createdCount: missingMailboxIds.length,
		requestId: args.requestId,
	};
}
