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

	for (const filter of filters) {
		if (!filter.enabled) continue;

		const matchesFrom = !filter.fromContains || fromAddr.includes(filter.fromContains);
		const matchesTo = !filter.toContains || toAddr.includes(filter.toContains);
		const matchesSubject = !filter.subjectContains || (subject ?? "").includes(filter.subjectContains);
		const matchesWords = !filter.hasWords || (subject ?? "").includes(filter.hasWords) || fromAddr.includes(filter.hasWords);

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
