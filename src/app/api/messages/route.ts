import { NextResponse } from "next/server";
import { desc, asc, and, count, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { enrichMessagesWithContacts } from "@/lib/messages/enrich";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { messageListConditions, messageListSortTime, parseMessageListCursor } from "@/lib/messages/list-conditions";

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
// Leave room for user, organization, role, and draft-access parameters in the
// access predicate under D1's 100 bound-parameter limit.
const THREAD_COUNT_BATCH_SIZE = 80;

export const GET = withUser(async ({ request, env, user }) => {
	const url = new URL(request.url);
	const rawLimit = url.searchParams.get("limit");
	const parsedLimit = rawLimit === null ? DEFAULT_MESSAGE_LIMIT : Number(rawLimit);
	if (
		rawLimit?.trim() === "" ||
		!Number.isFinite(parsedLimit) ||
		!Number.isInteger(parsedLimit) ||
		parsedLimit < 1
	) {
		return apiError("Invalid limit", 400);
	}
	const limit = Math.min(parsedLimit, MAX_MESSAGE_LIMIT);

	const rawOffset = url.searchParams.get("offset");
	const offset = rawOffset === null ? 0 : Number(rawOffset);
	const cursor = parseMessageListCursor(url.searchParams.get("after"));
	if (cursor === false) return apiError("Invalid message cursor", 400);
	if (
		rawOffset?.trim() === "" ||
		!Number.isFinite(offset) ||
		!Number.isInteger(offset) ||
		offset < 0
	) {
		return apiError("Invalid offset", 400);
	}

	const db = getDb(env);
	const nowSeconds = Math.floor(Date.now() / 1000);
	const conditions = messageListConditions(db, user, url.searchParams, nowSeconds);
	if (conditions.error === "status") return NextResponse.json({ error: "Invalid message status" }, { status: 400 });
	if (conditions.error) return apiError(conditions.error === "focus" ? "Invalid focus" : "Invalid age", 400);
	const { where, snoozedView } = conditions;
	// A woken message sorts by its wake time, so it returns to the top of the Inbox.
	const sortTime = snoozedView ? sql<number>`${messages.snoozedUntil}` : messageListSortTime;
	const order = snoozedView ? asc : desc;
	// The scalar bound lets SQLite seek into the expression index. The tuple
	// then resolves ties within that timestamp.
	const pageWhere = cursor ? and(where, snoozedView
		? sql`${sortTime} >= ${cursor.time} and (${sortTime}, ${messages.id}) > (${cursor.time}, ${cursor.id})`
		: sql`${sortTime} <= ${cursor.time} and (${sortTime}, ${messages.id}) < (${cursor.time}, ${cursor.id})`) : where;

	const [totalRow] = await db
		.select({ total: count() })
		.from(messages)
		.where(where);
	const rows = await db
		.select()
		.from(messages)
		.where(pageWhere)
		.orderBy(order(sortTime), order(messages.id))
		.limit(limit)
		.offset(cursor ? 0 : offset);
	const threadIds = [...new Set(
		rows.flatMap((message) => message.threadId ? [message.threadId] : []),
	)];
	const threadCounts = new Map<string, number>();
	for (let index = 0; index < threadIds.length; index += THREAD_COUNT_BATCH_SIZE) {
		const batchThreadIds = threadIds.slice(index, index + THREAD_COUNT_BATCH_SIZE);
		const threadCountRows = await db
			.select({ threadId: messages.threadId, count: count() })
			.from(messages)
			.where(and(
				messageAccessCondition(db, user.id, user.organizationId, "read"),
				inArray(messages.threadId, batchThreadIds),
			))
			.groupBy(messages.threadId);
		for (const row of threadCountRows) {
			if (row.threadId) threadCounts.set(row.threadId, row.count);
		}
	}
	const enrichedRows = await enrichMessagesWithContacts(env, user.id, rows);
	const messagesWithThreadCounts = enrichedRows.map((message) => ({
		...message,
		threadCount: message.threadId ? Math.max(1, threadCounts.get(message.threadId) ?? 1) : 1,
	}));

	const last = rows.at(-1);
	const lastTime = last && (last.status === "received" ? last.snoozedUntil ?? last.createdAt : last.createdAt);
	const nextCursor = rows.length === limit && last?.id && lastTime instanceof Date
		? `${Math.floor(lastTime.getTime() / 1000)}:${last.id}` : null;
	return apiSuccess({ messages: messagesWithThreadCounts, total: totalRow?.total ?? 0, limit, offset, ...(nextCursor ? { nextCursor } : {}) });
});
