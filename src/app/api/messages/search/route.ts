import { NextResponse } from "next/server";
import { eq, desc, and, like, or } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { guardUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getContactDisplayNameMap } from "@/lib/contacts/service";
import { normalizeEmailAddress } from "@/lib/email/address";
import { getLatestEmailContent } from "@/lib/email/reply-content-utils";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export async function GET(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const url = new URL(request.url);
	const q = url.searchParams.get("q")?.trim() ?? "";
	const mailboxId = url.searchParams.get("mailboxId");

	const db = getDb(env);
	const conditions = [messageAccessCondition(db, user.id, user.organizationId, "read")];
	if (mailboxId) {
		conditions.push(eq(messages.mailboxId, mailboxId));
	}
	if (q) {
		const pattern = `%${q}%`;
		const queryCondition = or(
			like(messages.subject, pattern),
			like(messages.fromAddr, pattern),
			like(messages.toAddr, pattern),
			like(messages.snippet, pattern),
		);
		/* v8 ignore next -- or() over always-defined like()s is never undefined; guard is defensive */
		if (queryCondition) conditions.push(queryCondition);
	}

	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(50);

	const contactMap = await getContactDisplayNameMap(
		env,
		user.id,
		rows.flatMap((message) => [message.fromAddr, message.toAddr]),
	);
	const enrichedRows = rows.map((message) => ({
		...message,
		snippet: getLatestEmailContent(message.snippet),
		fromContactName: contactMap.get(normalizeEmailAddress(message.fromAddr)) ?? null,
		toContactName: contactMap.get(normalizeEmailAddress(message.toAddr)) ?? null,
	}));

	return NextResponse.json({ messages: enrichedRows });
}
