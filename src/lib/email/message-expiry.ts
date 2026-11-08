import { and, inArray, isNotNull, lte } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { messages } from "@/db/schema";

/**
 * Moves mail whose filter-set expiry has passed to Trash (F101). The expiry is cleared, so
 * mail the reader restores from Trash stays restored. Mail outside the Inbox and Archive
 * (already trashed, spam, sent) is left alone.
 */
export async function expireMessages(db: AppDatabase, now = new Date()): Promise<void> {
	await db.update(messages)
		.set({ status: "trash", expiresAt: null })
		.where(and(
			isNotNull(messages.expiresAt),
			lte(messages.expiresAt, now),
			inArray(messages.status, ["received", "archived"]),
		));
}
