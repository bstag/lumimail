export type InboxFocus = "focused" | "other";

export const INBOX_FOCUS_KEY = "picket:inbox-focus";

/** A stored Inbox tab choice (F97); anything unrecognized falls back to Focused. */
export function parseInboxFocus(value: string | null): InboxFocus {
	return value === "other" ? "other" : "focused";
}
