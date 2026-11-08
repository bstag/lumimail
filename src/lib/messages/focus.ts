import { and, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { getDb } from "@/db";
import { labels, messageLabels, messages } from "@/db/schema";

export type InboxFocus = "focused" | "other";

/** Tag names (F95 defaults) that mark bulk mail, and ones that always keep mail in Focused. */
export const BULK_TAGS = ["promotions", "newsletters", "updates"] as const;
export const PRIORITY_TAGS = ["personal", "needs reply"] as const;

export function parseInboxFocus(value: string | null): InboxFocus | null | "invalid" {
	if (value === null || value === "") return null;
	return value === "focused" || value === "other" ? value : "invalid";
}

function taggedWith(db: ReturnType<typeof getDb>, userId: string, names: readonly string[]) {
	return db.select({ messageId: messageLabels.messageId })
		.from(messageLabels)
		.innerJoin(labels, eq(labels.id, messageLabels.labelId))
		.where(and(eq(labels.userId, userId), inArray(sql`lower(${labels.name})`, [...names])));
}

/** The bare lowercase address of a single-address header such as `"Ada" <ada@x.test>`. */
export function addressOf(column: SQLiteColumn) {
	return sql<string>`lower(trim(case when instr(${column}, '<') > 0 and substr(trim(${column}), -1) = '>'
		then rtrim(substr(${column}, instr(${column}, '<') + 1), '>') else ${column} end))`;
}

/** Addresses this user has sent mail to, one recipient per message (lists are skipped). */
function correspondents(db: ReturnType<typeof getDb>, userId: string) {
	const sent = alias(messages, "sent_mail");
	return db.select({ address: addressOf(sent.toAddr) })
		.from(sent)
		.where(and(
			eq(sent.userId, userId),
			eq(sent.direction, "outbound"),
			eq(sent.status, "sent"),
			sql`instr(${sent.toAddr}, ',') = 0`,
		));
}

/**
 * Splits received mail into Focused and Other (F97). Other is bulk-tagged mail with no priority
 * tag, no star, and not from someone this user has written to; everything else, including
 * untagged mail, stays Focused so nothing is hidden while categorization is off or behind.
 */
export function inboxFocusCondition(db: ReturnType<typeof getDb>, userId: string, focus: InboxFocus): SQL {
	const bulk = taggedWith(db, userId, BULK_TAGS);
	const priority = taggedWith(db, userId, PRIORITY_TAGS);
	const fromCorrespondent = inArray(addressOf(messages.fromAddr), correspondents(db, userId));
	return (focus === "other"
		? and(
			inArray(messages.id, bulk),
			notInArray(messages.id, priority),
			eq(messages.starred, false),
			notInArray(addressOf(messages.fromAddr), correspondents(db, userId)),
		)
		: or(notInArray(messages.id, bulk), inArray(messages.id, priority), eq(messages.starred, true), fromCorrespondent)) as SQL;
}
