import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { mailboxMemberships, mailboxes, messages } from "@/db/schema";

export type MailboxRole = "viewer" | "responder" | "manager";
export type MailboxCapability = "read" | "send" | "manage";

export interface MailboxAccess {
	mailboxId: string;
	organizationId: string;
	role: MailboxRole;
}

const rolesForCapability: Record<MailboxCapability, readonly MailboxRole[]> = {
	read: ["viewer", "responder", "manager"],
	send: ["responder", "manager"],
	manage: ["manager"],
};

export function hasMailboxCapability(role: MailboxRole, capability: MailboxCapability): boolean {
	return rolesForCapability[capability].includes(role);
}

export async function getMailboxAccess(
	db: AppDatabase,
	userId: string,
	organizationId: string,
	mailboxId: string,
): Promise<MailboxAccess | null> {
	const [row] = await db
		.select({
			mailboxId: mailboxMemberships.mailboxId,
			organizationId: mailboxes.organizationId,
			role: mailboxMemberships.role,
		})
		.from(mailboxMemberships)
		.innerJoin(mailboxes, eq(mailboxes.id, mailboxMemberships.mailboxId))
		.where(
			and(
				eq(mailboxMemberships.userId, userId),
				eq(mailboxMemberships.mailboxId, mailboxId),
				eq(mailboxes.organizationId, organizationId),
			),
		)
		.limit(1);

	return row?.organizationId
		? { mailboxId: row.mailboxId, organizationId: row.organizationId, role: row.role }
		: null;
}

export async function listAccessibleMailboxIds(
	db: AppDatabase,
	userId: string,
	organizationId: string,
	capability: MailboxCapability,
): Promise<string[]> {
	const rows = await db
		.select({ mailboxId: mailboxMemberships.mailboxId })
		.from(mailboxMemberships)
		.innerJoin(mailboxes, eq(mailboxes.id, mailboxMemberships.mailboxId))
		.where(
			and(
				eq(mailboxMemberships.userId, userId),
				eq(mailboxes.organizationId, organizationId),
				inArray(mailboxMemberships.role, [...rolesForCapability[capability]]),
			),
		);

	return rows.map((row) => row.mailboxId);
}

function messageAccessForRoles(
	db: AppDatabase,
	userId: string,
	organizationId: string | null,
	roles: readonly MailboxRole[],
) {
	const privateMessage = and(isNull(messages.mailboxId), eq(messages.userId, userId));
	if (!organizationId) return privateMessage;

	const accessibleMailboxIds = db
		.select({ mailboxId: mailboxMemberships.mailboxId })
		.from(mailboxMemberships)
		.innerJoin(mailboxes, eq(mailboxes.id, mailboxMemberships.mailboxId))
		.where(and(
			eq(mailboxMemberships.userId, userId),
			eq(mailboxes.organizationId, organizationId),
			inArray(mailboxMemberships.role, [...roles]),
		));

	return or(
		privateMessage,
		and(
			eq(messages.organizationId, organizationId),
			inArray(messages.mailboxId, accessibleMailboxIds),
		),
	);
}

export function messageAccessCondition(
	db: AppDatabase,
	userId: string,
	organizationId: string | null,
	capability: MailboxCapability,
) {
	const capabilityAccess = messageAccessForRoles(
		db,
		userId,
		organizationId,
		rolesForCapability[capability],
	);
	if (capability !== "read") return capabilityAccess;

	const draftAccess = messageAccessForRoles(
		db,
		userId,
		organizationId,
		rolesForCapability.send,
	);
	return or(
		and(ne(messages.status, "draft"), capabilityAccess),
		and(eq(messages.status, "draft"), draftAccess),
	);
}
