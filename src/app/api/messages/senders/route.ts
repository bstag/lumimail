import { desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { addressOf } from "@/lib/messages/focus";
import { messageListConditions } from "@/lib/messages/list-conditions";

const DEFAULT_LIMIT = 25;
// Group rows are small; the grouped Inbox grows its page by 25 up to this.
const MAX_SENDER_LIMIT = 500;

function paging(params: URLSearchParams) {
	const limit = Number(params.get("limit") ?? DEFAULT_LIMIT);
	const offset = Number(params.get("offset") ?? 0);
	if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) return null;
	return { limit: Math.min(limit, MAX_SENDER_LIMIT), offset };
}

/**
 * A list view grouped by sender address, newest sender first (F103): message and unread
 * counts, and the newest message's id, subject and time. Takes the list's parameters.
 */
export const GET = withUser(async ({ request, env, user }) => {
	const params = new URL(request.url).searchParams;
	const page = paging(params);
	if (!page) return apiError("Invalid paging", 400);
	const db = getDb(env);
	const conditions = messageListConditions(db, user, params);
	if (conditions.error) return apiError("Invalid query", 400);

	const sender = addressOf(messages.fromAddr);
	const [totals] = await db.select({ total: sql<number>`count(distinct ${sender})` }).from(messages).where(conditions.where);
	// SQLite returns the bare columns from the row that holds max(created_at).
	const groups = await db.select({
		sender,
		fromAddr: messages.fromAddr,
		count: sql<number>`count(*)`,
		unread: sql<number>`sum(case when ${messages.read} then 0 else 1 end)`,
		latestId: messages.id,
		latestSubject: messages.subject,
		latestAt: sql<number>`max(${messages.createdAt})`.as("latest_at"),
	}).from(messages).where(conditions.where).groupBy(sender)
		.orderBy(desc(sql`max(${messages.createdAt})`)).limit(page.limit).offset(page.offset);

	return apiSuccess({
		/* v8 ignore next -- count(distinct) always yields one row; the fallback is defensive */
		total: totals?.total ?? 0,
		senders: groups.map((group) => ({ ...group, latestAt: new Date(group.latestAt * 1000).toISOString() })),
	});
});
