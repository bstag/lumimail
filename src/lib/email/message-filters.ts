import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { messageFilters, messageLabels, messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import {
	DAY_SECONDS,
	filterCondition,
	filterParameterCount,
	filterUpdates,
	type MessageFilterRow,
} from "./filter-condition";

// D1 allows about 100 bound parameters per statement; leave room for the message id.
const PARAMETER_BUDGET = 80;

/** Groups filters so each evaluation query stays under the parameter budget. */
function chunkByParameters(filters: Array<{ filter: MessageFilterRow; condition: SQL }>) {
	const chunks: Array<typeof filters> = [];
	let current: typeof filters = [];
	let used = 0;
	for (const entry of filters) {
		const cost = filterParameterCount(entry.filter);
		if (current.length > 0 && used + cost > PARAMETER_BUDGET) {
			chunks.push(current);
			current = [];
			used = 0;
		}
		current.push(entry);
		used += cost;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

/** The owner's enabled filters that can match something, with their SQL conditions. */
async function enabledFilters(db: AppDatabase, userId: string) {
	const rows = await db.select().from(messageFilters)
		.where(and(eq(messageFilters.userId, userId), eq(messageFilters.enabled, true)));
	return rows.flatMap((filter) => {
		const condition = filterCondition(filter);
		return condition ? [{ filter, condition }] : [];
	});
}

/**
 * Applies the owner's message filters to a freshly stored inbound message (body included).
 *
 * Matching is the same SQL condition used for existing mail (F101). The actions of every
 * matching filter are merged into one update, later filters winning on conflicting values,
 * so at most one `messages` write happens per delivery. Labels are idempotent inserts.
 */
export async function applyMessageFilters(
	db: AppDatabase,
	userId: string,
	messageId: string,
	now = new Date(),
): Promise<void> {
	const filters = await enabledFilters(db, userId);
	const matched: MessageFilterRow[] = [];
	for (const chunk of chunkByParameters(filters)) {
		const columns = Object.fromEntries(chunk.map(({ condition }, index) =>
			[`f${index}`, sql<number>`case when ${condition} then 1 else 0 end`]));
		const [row] = await db.select(columns).from(messages).where(eq(messages.id, messageId)).limit(1);
		chunk.forEach(({ filter }, index) => {
			if (row && Number(row[`f${index}`]) === 1) matched.push(filter);
		});
	}

	const updates: Partial<typeof messages.$inferInsert> = {};
	for (const filter of matched) {
		Object.assign(updates, filterUpdates(filter));
		if (filter.actionExpireDays) {
			updates.expiresAt = new Date(now.getTime() + filter.actionExpireDays * DAY_SECONDS * 1000);
		}
	}
	if (Object.keys(updates).length > 0) {
		await db.update(messages).set(updates).where(eq(messages.id, messageId));
	}
	for (const filter of matched) {
		if (filter.actionLabelId) {
			await db.insert(messageLabels).values({ messageId, labelId: filter.actionLabelId }).onConflictDoNothing();
		}
	}
}

type Viewer = { id: string; organizationId: string | null };

/** Received or archived inbound mail the viewer can access that the filter matches. */
function existingScope(db: AppDatabase, viewer: Viewer, condition: SQL) {
	return and(
		messageAccessCondition(db, viewer.id, viewer.organizationId, "read"),
		eq(messages.direction, "inbound"),
		inArray(messages.status, ["received", "archived"]),
		condition,
	) as SQL;
}

/**
 * Counts, and unless `preview` applies, a filter's actions on existing mail (F101). Expiry
 * counts from each message's arrival, so mail already past it is trashed on the next run.
 */
export async function applyFilterToExisting(
	db: AppDatabase,
	viewer: Viewer,
	filter: MessageFilterRow,
	{ preview }: { preview: boolean },
): Promise<{ matched: number }> {
	const condition = filterCondition(filter);
	if (!condition) return { matched: 0 };
	const scope = existingScope(db, viewer, condition);
	const [row] = await db.select({ matched: sql<number>`count(*)` }).from(messages).where(scope);
	/* v8 ignore next -- count(*) always yields one row; the fallback is defensive */
	const matched = Number(row?.matched ?? 0);
	if (preview || matched === 0) return { matched };

	// Labels first: a trash action takes the mail out of the scope.
	if (filter.actionLabelId) {
		await db.insert(messageLabels)
			.select(db.select({ messageId: messages.id, labelId: sql<string>`${filter.actionLabelId}`.as("label_id") })
				.from(messages).where(scope))
			.onConflictDoNothing();
	}
	const updates: Record<string, unknown> = { ...filterUpdates(filter) };
	if (filter.actionExpireDays) {
		updates.expiresAt = sql`${messages.createdAt} + ${filter.actionExpireDays * DAY_SECONDS}`;
	}
	if (Object.keys(updates).length > 0) {
		await db.update(messages).set(updates).where(scope);
	}
	return { matched };
}
