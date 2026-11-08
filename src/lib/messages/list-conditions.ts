import { and, eq, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { labels, messageLabels, messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { addressOf, inboxFocusCondition, parseInboxFocus } from "@/lib/messages/focus";

const ALLOWED_STATUSES = new Set(["received", "sent", "draft", "queued", "failed", "trash", "spam", "archived"]);
const MAX_AGE_DAYS = 3650;

export type ListConditionError = "status" | "focus" | "age";
export type ListConditions = { where: SQL; snoozedView: boolean; error?: never } | { error: ListConditionError };

type Viewer = { id: string; organizationId: string | null };

function statusCondition(status: string | null): SQL | null | "invalid" {
	if (!status) return null;
	const requested = [...new Set(status.split(",").filter(Boolean))];
	if (requested.length === 0 || requested.some((value) => !ALLOWED_STATUSES.has(value))) return "invalid";
	return requested.length === 1 ? eq(messages.status, requested[0]) : inArray(messages.status, requested);
}

function ageCondition(raw: string | null, nowSeconds: number): SQL | null | "invalid" {
	if (raw === null) return null;
	const days = Number(raw);
	if (raw.trim() === "" || !Number.isInteger(days) || days < 1 || days > MAX_AGE_DAYS) return "invalid";
	return lt(messages.createdAt, new Date((nowSeconds - days * 86_400) * 1000));
}

function textConditions(params: URLSearchParams): SQL[] {
	const conditions: SQL[] = [];
	const query = params.get("q")?.trim();
	if (query) {
		const pattern = `%${query}%`;
		conditions.push(or(
			like(messages.fromAddr, pattern), like(messages.toAddr, pattern),
			like(messages.subject, pattern), like(messages.snippet, pattern),
		) as SQL);
	}
	const title = params.get("title")?.trim();
	if (title) conditions.push(like(messages.subject, `%${title}%`));
	return conditions;
}

function flagConditions(params: URLSearchParams): SQL[] {
	const conditions: SQL[] = [];
	const direction = params.get("direction");
	if (direction === "inbound" || direction === "outbound") conditions.push(eq(messages.direction, direction));
	const mailboxId = params.get("mailboxId");
	if (mailboxId) conditions.push(eq(messages.mailboxId, mailboxId));
	const read = params.get("read");
	if (read === "read" || read === "unread") conditions.push(eq(messages.read, read === "read"));
	if (params.get("starred") === "true") conditions.push(eq(messages.starred, true));
	// One sender's mail, by bare address, for the grouped Inbox (F103).
	const sender = params.get("sender")?.trim().toLowerCase();
	if (sender) conditions.push(eq(addressOf(messages.fromAddr), sender));
	return conditions;
}

function labelCondition(db: AppDatabase, userId: string, labelId: string | null): SQL[] {
	if (!labelId) return [];
	const labelled = db.select({ messageId: messageLabels.messageId })
		.from(messageLabels)
		.innerJoin(labels, eq(labels.id, messageLabels.labelId))
		.where(and(eq(messageLabels.labelId, labelId), eq(labels.userId, userId)));
	return [inArray(messages.id, labelled)];
}

/**
 * The one definition of which messages a list view shows, shared by the list endpoint and
 * query-scoped bulk actions (F102), so "select all in this view" acts on exactly that set.
 * Snoozed received mail is hidden until it wakes, except in the Snoozed view (F100).
 */
export function messageListConditions(
	db: AppDatabase,
	viewer: Viewer,
	params: URLSearchParams,
	nowSeconds = Math.floor(Date.now() / 1000),
): ListConditions {
	const focus = parseInboxFocus(params.get("focus"));
	if (focus === "invalid") return { error: "focus" };
	const status = statusCondition(params.get("status"));
	if (status === "invalid") return { error: "status" };
	const age = ageCondition(params.get("olderThanDays"), nowSeconds);
	if (age === "invalid") return { error: "age" };

	const snoozedView = params.get("snoozed") === "true";
	const snoozedNow = sql`(${messages.status} = 'received' and ${messages.snoozedUntil} > ${nowSeconds})`;
	const conditions = [
		messageAccessCondition(db, viewer.id, viewer.organizationId, "read") as SQL,
		...flagConditions(params),
		...(status ? [status] : []),
		...textConditions(params),
		...labelCondition(db, viewer.id, params.get("labelId")),
		...(focus ? [inboxFocusCondition(db, viewer.id, focus)] : []),
		...(age ? [age] : []),
		snoozedView ? snoozedNow : sql`(${messages.snoozedUntil} is null or not ${snoozedNow})`,
	];
	return { where: and(...conditions) as SQL, snoozedView };
}
