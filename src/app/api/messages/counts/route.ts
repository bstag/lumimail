import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { buildMessageCounts } from "./utils";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export const GET = withUser(async ({ request, env, user }) => {
	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const db = getDb(env);
	const conditions = [messageAccessCondition(db, user.id, user.organizationId, "read")];

	if (mailboxId) {
		conditions.push(eq(messages.mailboxId, mailboxId));
	}

	const rows = await db
		.select({
			mailboxId: messages.mailboxId,
			direction: messages.direction,
			status: messages.status,
			read: messages.read,
		})
		.from(messages)
		.where(and(...conditions));

	return NextResponse.json({ counts: buildMessageCounts(rows) });
});
