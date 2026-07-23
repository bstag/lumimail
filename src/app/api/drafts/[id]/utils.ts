import { and, eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { messageBodies, messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

type Db = ReturnType<typeof getDb>;

export function selectDraftWithBody(
	db: Db,
	userId: string,
	organizationId: string | null,
	draftId: string,
) {
	return db
		.select({
			id: messages.id,
			userId: messages.userId,
			mailboxId: messages.mailboxId,
			fromAddr: messages.fromAddr,
			toAddr: messages.toAddr,
			subject: messages.subject,
			status: messages.status,
			textBody: messageBodies.textBody,
			htmlBody: messageBodies.htmlBody,
		})
		.from(messages)
		.leftJoin(messageBodies, eq(messageBodies.messageId, messages.id))
		.where(and(eq(messages.id, draftId), messageAccessCondition(db, userId, organizationId, "send")))
		.limit(1)
		.then(([draft]) => (draft?.status === "draft" ? draft : null));
}
