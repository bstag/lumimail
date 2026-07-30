import { eq, and, asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/handler";
import { getDb } from "@/db";
import { messages, messageBodies } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export const GET = withUser<{ threadId: string }>(async ({ env, user, params }) => {
	const { threadId } = params;

	const db = getDb(env);
	const rows = await db
		.select({
			id: messages.id,
			userId: messages.userId,
			mailboxId: messages.mailboxId,
			direction: messages.direction,
			providerMessageId: messages.providerMessageId,
			fromAddr: messages.fromAddr,
			toAddr: messages.toAddr,
			subject: messages.subject,
			snippet: messages.snippet,
			status: messages.status,
			read: messages.read,
			starred: messages.starred,
			threadId: messages.threadId,
			createdAt: messages.createdAt,
			textBody: messageBodies.textBody,
			htmlBody: messageBodies.htmlBody,
		})
		.from(messages)
		.leftJoin(messageBodies, eq(messageBodies.messageId, messages.id))
		.where(and(eq(messages.threadId, threadId), messageAccessCondition(db, user.id, user.organizationId, "read")))
		.orderBy(asc(messages.createdAt));

	return NextResponse.json({ messages: rows });
});
