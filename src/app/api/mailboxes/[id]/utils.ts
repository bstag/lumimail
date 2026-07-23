import { and, eq, inArray } from "drizzle-orm";
import { domains, mailboxMemberships, mailboxes } from "@/db/schema";
import type { getDb } from "@/db";
import type { MailboxRole } from "@/lib/auth/mailbox-access";
import type { MailboxUpdateValues } from "./types";

type Db = ReturnType<typeof getDb>;

export function selectMailboxForUser(
	db: Db,
	organizationId: string,
	userId: string,
	mailboxId: string,
	roles: MailboxRole[],
) {
	return db
		.select({
			id: mailboxes.id,
			userId: mailboxes.userId,
			domainId: mailboxes.domainId,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			createdAt: mailboxes.createdAt,
			hostname: domains.hostname,
			role: mailboxMemberships.role,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.innerJoin(mailboxMemberships, eq(mailboxMemberships.mailboxId, mailboxes.id))
		.where(and(
			eq(mailboxes.id, mailboxId),
			eq(mailboxes.organizationId, organizationId),
			eq(mailboxMemberships.userId, userId),
			inArray(mailboxMemberships.role, roles),
		))
		.limit(1);
}

export function selectMailboxForOrganization(db: Db, organizationId: string, mailboxId: string) {
	return db
		.select({
			id: mailboxes.id,
			localPart: mailboxes.localPart,
			hostname: domains.hostname,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.organizationId, organizationId)))
		.limit(1);
}

export function getMailboxUpdateValues(input: MailboxUpdateValues): MailboxUpdateValues {
	if (!("displayName" in input)) return {};

	const displayName = input.displayName?.trim() || null;
	return { displayName };
}
