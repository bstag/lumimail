import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { messageFilters, messageLabels, messages } from "@/db/schema";

/**
 * Applies the owner's message filters to a freshly stored inbound message.
 *
 * The field actions of every matching filter are merged into a single update
 * (later filters win on conflicting status actions, matching the previous
 * sequential-update semantics), so at most one `messages` write happens per
 * delivery. Label attachments are idempotent inserts per matching filter.
 */
export async function applyMessageFilters(
	db: AppDatabase,
	userId: string,
	messageId: string,
	fromAddr: string,
	toAddr: string,
	subject: string | undefined,
): Promise<void> {
	const filters = await db
		.select()
		.from(messageFilters)
		.where(eq(messageFilters.userId, userId));

	const updates: Partial<typeof messages.$inferSelect> = {};
	const labelIds: string[] = [];

	// Case-insensitive, as in mainstream mail clients: addresses are case-insensitive in
	// practice and senders vary their capitalization.
	const from = fromAddr.toLowerCase();
	const to = toAddr.toLowerCase();
	const title = (subject ?? "").toLowerCase();
	const contains = (value: string, needle: string | null) => !needle || value.includes(needle.toLowerCase());

	for (const filter of filters) {
		if (!filter.enabled) continue;

		const matchesFrom = contains(from, filter.fromContains);
		const matchesTo = contains(to, filter.toContains);
		const matchesSubject = contains(title, filter.subjectContains);
		const matchesWords = !filter.hasWords || contains(title, filter.hasWords) || contains(from, filter.hasWords);

		if (!matchesFrom || !matchesTo || !matchesSubject || !matchesWords) continue;

		if (filter.actionStar) updates.starred = true;
		if (filter.actionMarkRead) updates.read = true;
		if (filter.actionMoveToTrash) updates.status = "trash";
		if (filter.actionArchive) updates.status = "archived";

		if (filter.actionLabelId) labelIds.push(filter.actionLabelId);
	}

	if (Object.keys(updates).length > 0) {
		await db.update(messages).set(updates).where(eq(messages.id, messageId));
	}

	for (const labelId of labelIds) {
		await db.insert(messageLabels).values({ messageId, labelId }).onConflictDoNothing();
	}
}
