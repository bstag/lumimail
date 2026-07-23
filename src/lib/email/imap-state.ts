import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export type ImapStateChange = {
	read?: boolean;
	status?: "trash";
};

export async function updateMessageForImap(
	env: CloudflareEnv,
	userId: string,
	organizationId: string | null,
	messageId: string,
	mailboxId: string,
	change: ImapStateChange,
) {
	const db = getDb(env);
	const [message] = await db
		.select()
		.from(messages)
		.where(and(
			eq(messages.id, messageId),
			eq(messages.mailboxId, mailboxId),
			messageAccessCondition(db, userId, organizationId, "read"),
		))
		.limit(1);
	if (!message) return null;

	const [updated] = await db
		.update(messages)
		.set(change)
		.where(eq(messages.id, messageId))
		.returning();
	return updated ?? { ...message, ...change };
}
