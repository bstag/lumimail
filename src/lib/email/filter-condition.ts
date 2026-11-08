import { and, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { messageBodies, messageFilters, messages } from "@/db/schema";

export type MessageFilterRow = typeof messageFilters.$inferSelect;
export type FilterRules = Pick<MessageFilterRow, "fromContains" | "toContains" | "subjectContains" | "hasWords" | "matchMode">;

/** Most alternatives one filter field may list, which keeps a filter's bound parameters bounded. */
export const MAX_FILTER_ALTERNATIVES = 10;

/** The comma-separated alternatives of a filter field, trimmed and lowercased (F101). */
export function filterAlternatives(value: string | null | undefined): string[] {
	return (value ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
}

// instr() rather than LIKE, so `%` and `_` in a needle are literal.
const contains = (column: SQLiteColumn, needle: string) => sql`instr(lower(coalesce(${column}, '')), ${needle}) > 0`;

const bodyContains = (needle: string) => sql`exists (select 1 from ${messageBodies}
	where ${messageBodies.messageId} = ${messages.id}
	and instr(lower(coalesce(${messageBodies.textBody}, '')), ${needle}) > 0)`;

function anyOf(parts: SQL[]): SQL | null {
	return parts.length > 0 ? (or(...parts) as SQL) : null;
}

function fieldCondition(column: SQLiteColumn, value: string | null) {
	return anyOf(filterAlternatives(value).map((needle) => contains(column, needle)));
}

/** "Has words" looks in the subject, sender, snippet, and plain-text body. */
function wordsCondition(value: string | null) {
	return anyOf(filterAlternatives(value).map((needle) => or(
		contains(messages.subject, needle),
		contains(messages.fromAddr, needle),
		contains(messages.snippet, needle),
		bodyContains(needle),
	) as SQL));
}

/**
 * The one matching rule for a filter, used for new mail and for existing mail alike, as a
 * condition on `messages`. A filter with no conditions matches nothing (it used to match all).
 */
export function filterCondition(filter: FilterRules): SQL | null {
	const parts = [
		fieldCondition(messages.fromAddr, filter.fromContains),
		fieldCondition(messages.toAddr, filter.toContains),
		fieldCondition(messages.subject, filter.subjectContains),
		wordsCondition(filter.hasWords),
	].filter((part): part is SQL => part !== null);
	if (parts.length === 0) return null;
	return (filter.matchMode === "any" ? or(...parts) : and(...parts)) as SQL;
}

/** Bound parameters a filter's condition uses: one per alternative, four per word. */
export function filterParameterCount(filter: FilterRules): number {
	return filterAlternatives(filter.fromContains).length
		+ filterAlternatives(filter.toContains).length
		+ filterAlternatives(filter.subjectContains).length
		+ 4 * filterAlternatives(filter.hasWords).length;
}

export type FilterActions = Pick<MessageFilterRow,
	"actionStar" | "actionMarkRead" | "actionArchive" | "actionMoveToTrash" | "actionFocus" | "actionExpireDays">;

/**
 * The message columns a filter's actions set, except expiry, whose start time depends on the
 * caller. Archive is applied after trash within one filter, matching the original behaviour.
 */
export function filterUpdates(filter: FilterActions): Partial<typeof messages.$inferInsert> {
	const updates: Partial<typeof messages.$inferInsert> = {};
	if (filter.actionStar) updates.starred = true;
	if (filter.actionMarkRead) updates.read = true;
	if (filter.actionMoveToTrash) updates.status = "trash";
	if (filter.actionArchive) updates.status = "archived";
	if (filter.actionFocus) updates.focusOverride = filter.actionFocus;
	return updates;
}

export const DAY_SECONDS = 86_400;
