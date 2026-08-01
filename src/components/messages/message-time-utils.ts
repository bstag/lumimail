import dayjs from "dayjs";

/**
 * The timestamp shown on a message-list row.
 *
 * The column is narrow — on a phone it shares a line with the sender and the
 * mailbox chip — so the format degrades with age rather than always printing a
 * full date: today's mail is scanned by time of day, this year's by month and
 * day, and anything older falls back to digits that fit.
 *
 * `now` is a parameter rather than read from the clock so the result is
 * testable and so a caller can render a whole list against one instant.
 */
export function formatMessageListTime(createdAt: string | Date, now: Date): string {
	const value = dayjs(createdAt);
	// dayjs prints "Invalid Date" for unparseable input, which would look like
	// real content in the row.
	if (!value.isValid()) return "";

	const reference = dayjs(now);
	if (value.isSame(reference, "day")) return value.format("h:mm A");
	if (value.isSame(reference, "year")) return value.format("MMM D");
	return value.format("M/D/YY");
}
