import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageBodies, messages } from "@/db/schema";
import { getMessageContactNames } from "@/lib/contacts/service";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export async function getMessageWithBody(
	env: CloudflareEnv,
	userId: string,
	organizationId: string | null,
	messageId: string,
	mailboxId?: string,
) {
	const db = getDb(env);
	const [message] = await db
		.select()
		.from(messages)
		.where(and(
			eq(messages.id, messageId),
			...(mailboxId ? [eq(messages.mailboxId, mailboxId)] : []),
			messageAccessCondition(db, userId, organizationId, "read"),
		))
		.limit(1);
	if (!message) return null;
	const [body] = await db
		.select()
		.from(messageBodies)
		.where(eq(messageBodies.messageId, messageId))
		.limit(1);
	const contactNames = await getMessageContactNames(env, userId, message.fromAddr, message.toAddr);
	return { message: { ...message, ...contactNames }, body };
}
