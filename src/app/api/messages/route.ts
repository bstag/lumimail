import { NextResponse } from "next/server";
import { eq, desc, and, like, or, count, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { labels, messages, messageLabels } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { enrichMessagesWithContacts } from "@/lib/messages/enrich";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export const GET = withUser(async ({ request, env, user }) => {
	const url = new URL(request.url);
	const direction = url.searchParams.get("direction");
	const mailboxId = url.searchParams.get("mailboxId");
	const status = url.searchParams.get("status");
	const query = url.searchParams.get("q")?.trim();
	const title = url.searchParams.get("title")?.trim();
	const read = url.searchParams.get("read");
	const starred = url.searchParams.get("starred");
	const labelId = url.searchParams.get("labelId");
	const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
	const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

	const db = getDb(env);
	const conditions = [messageAccessCondition(db, user.id, user.organizationId, "read")];
	if (direction === "inbound" || direction === "outbound") {
		conditions.push(eq(messages.direction, direction));
	}
	if (mailboxId) {
		conditions.push(eq(messages.mailboxId, mailboxId));
	}
	if (status) {
		const allowedStatuses = new Set([
			"received",
			"sent",
			"draft",
			"queued",
			"failed",
			"trash",
			"spam",
			"archived",
		]);
		const requestedStatuses = [...new Set(status.split(",").filter(Boolean))];
		if (
			requestedStatuses.length === 0 ||
			requestedStatuses.some((requestedStatus) => !allowedStatuses.has(requestedStatus))
		) {
			return NextResponse.json({ error: "Invalid message status" }, { status: 400 });
		}
		conditions.push(
			requestedStatuses.length === 1
				? eq(messages.status, requestedStatuses[0])
				: inArray(messages.status, requestedStatuses),
		);
	}
	if (read === "read") {
		conditions.push(eq(messages.read, true));
	}
	if (read === "unread") {
		conditions.push(eq(messages.read, false));
	}
	if (starred === "true") {
		conditions.push(eq(messages.starred, true));
	}
	if (query) {
		const pattern = `%${query}%`;
		const queryCondition = or(
			like(messages.fromAddr, pattern),
			like(messages.toAddr, pattern),
			like(messages.subject, pattern),
			like(messages.snippet, pattern),
		);
		/* v8 ignore next -- or() over always-defined like()s is never undefined; guard is defensive */
		if (queryCondition) conditions.push(queryCondition);
	}
	if (title) {
		conditions.push(like(messages.subject, `%${title}%`));
	}
	if (labelId) {
		const labelledMessageIds = await db
			.select({ messageId: messageLabels.messageId })
			.from(messageLabels)
			.innerJoin(labels, eq(labels.id, messageLabels.labelId))
			.where(and(eq(messageLabels.labelId, labelId), eq(labels.userId, user.id)));
		const ids = labelledMessageIds.map((r) => r.messageId);
		if (ids.length === 0) {
			return apiSuccess({ messages: [], total: 0, limit, offset });
		}
		conditions.push(inArray(messages.id, ids));
	}
	const where = and(...conditions);

	const [totalRow] = await db
		.select({ total: count() })
		.from(messages)
		.where(where);
	const rows = await db
		.select()
		.from(messages)
		.where(where)
		.orderBy(desc(messages.createdAt))
		.limit(limit)
		.offset(offset);
	const enrichedRows = await enrichMessagesWithContacts(env, user.id, rows);

	return apiSuccess({ messages: enrichedRows, total: totalRow?.total ?? 0, limit, offset });
});
