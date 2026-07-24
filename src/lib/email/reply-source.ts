import { and, eq, ne } from "drizzle-orm";
import type { getDb } from "@/db";
import { messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

type Db = ReturnType<typeof getDb>;

export function selectAccessibleReplySource(
	db: Db,
	userId: string,
	organizationId: string | null,
	mailboxId: string,
	messageId: string,
) {
	return db
		.select({
			id: messages.id,
			threadId: messages.threadId,
			rfcMessageId: messages.rfcMessageId,
			providerMessageId: messages.providerMessageId,
			referencesHeader: messages.referencesHeader,
		})
		.from(messages)
		.where(and(
			eq(messages.id, messageId),
			eq(messages.mailboxId, mailboxId),
			ne(messages.status, "draft"),
			messageAccessCondition(db, userId, organizationId, "read"),
		))
		.limit(1)
		.then(([source]) => source ?? null);
}
