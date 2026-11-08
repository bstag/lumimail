import { and, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
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

/**
 * Splits received mail into Focused and Other (F97). Other is bulk-tagged mail with no priority
 * tag and no star; everything else, including untagged mail, stays Focused so nothing is hidden
 * while categorization is off or behind.
 */
export function inboxFocusCondition(db: ReturnType<typeof getDb>, userId: string, focus: InboxFocus): SQL {
	const bulk = taggedWith(db, userId, BULK_TAGS);
	const priority = taggedWith(db, userId, PRIORITY_TAGS);
	return (focus === "other"
		? and(inArray(messages.id, bulk), notInArray(messages.id, priority), eq(messages.starred, false))
		: or(notInArray(messages.id, bulk), inArray(messages.id, priority), eq(messages.starred, true))) as SQL;
}
