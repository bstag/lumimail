import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { addressOf, inboxFocusCondition } from "@/lib/messages/focus";

const WINDOW_SECONDS = 24 * 60 * 60;
const MAX_SENDERS = 20;
const MAX_UNREAD_IDS = 500;

/**
 * The last 24 hours of the Other inbox, grouped by sender (F99): how much bulk mail arrived,
 * from whom, the newest subject from each, and the unread IDs for one-step "mark all read".
 */
export const GET = withUser(async ({ request, env, user }) => {
	const mailboxId = new URL(request.url).searchParams.get("mailboxId");
	const db = getDb(env);
	const since = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;
	const where = and(
		messageAccessCondition(db, user.id, user.organizationId, "read"),
		eq(messages.direction, "inbound"),
		eq(messages.status, "received"),
		mailboxId ? eq(messages.mailboxId, mailboxId) : undefined,
		sql`coalesce(${messages.receivedAt}, ${messages.createdAt}) >= ${since}`,
		inboxFocusCondition(db, user.id, "other"),
	);
	const sender = addressOf(messages.fromAddr);
	// SQLite returns the bare columns from the row that holds max(created_at).
	const groups = await db.select({
		sender,
		fromAddr: messages.fromAddr,
		count: sql<number>`count(*)`,
		unread: sql<number>`sum(case when ${messages.read} then 0 else 1 end)`,
		latestId: messages.id,
		latestSubject: messages.subject,
		latestAt: sql<number>`max(${messages.createdAt})`.as("latest_at"),
	}).from(messages).where(where).groupBy(sender).orderBy(desc(sql`count(*)`), desc(sql`max(${messages.createdAt})`));
	const unreadIds = await db.select({ id: messages.id }).from(messages)
		.where(and(where, eq(messages.read, false)))
		.limit(MAX_UNREAD_IDS);

	return apiSuccess({
		total: groups.reduce((sum, group) => sum + group.count, 0),
		senderCount: groups.length,
		senders: groups.slice(0, MAX_SENDERS).map((group) => ({
			sender: group.sender,
			fromAddr: group.fromAddr,
			count: group.count,
			unread: group.unread,
			latestId: group.latestId,
			latestSubject: group.latestSubject,
		})),
		unreadIds: unreadIds.map((row) => row.id),
	});
});
