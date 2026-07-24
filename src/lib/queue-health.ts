import { and, count, eq, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { outboundJobs, queueHealthSnapshots } from "@/db/schema";

export type QueueHealthKey = "inbound" | "outbound" | "outbound_dlq";
export type QueueHealthStatus = "healthy" | "delayed" | "attention" | "unavailable";

export type QueueHealthSnapshot = {
	queue: QueueHealthKey;
	label: string;
	status: QueueHealthStatus;
	backlogCount: number;
	backlogBytes: number;
	oldestMessageAt: string | null;
	staleJobCount: number;
	detail: string | null;
	checkedAt: string;
};

const ATTENTION_AFTER_MS = 2 * 60 * 1000;
const QUEUED_STALE_AFTER_MS = 2 * 60 * 1000;
const PROCESSING_STALE_AFTER_MS = 10 * 60 * 1000;

const queueDefinitions: ReadonlyArray<{
	key: QueueHealthKey;
	label: string;
	getBinding: (env: CloudflareEnv) => Queue;
}> = [
	{ key: "inbound", label: "Inbound mail", getBinding: (env) => env.INBOUND_QUEUE },
	{ key: "outbound", label: "Outbound mail", getBinding: (env) => env.OUTBOUND_QUEUE },
	{
		key: "outbound_dlq",
		label: "Outbound dead letters",
		getBinding: (env) => env.OUTBOUND_DLQ_QUEUE,
	},
];

function normalizeCount(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeTimestamp(value: Date | number | undefined): Date | null {
	const timestamp = typeof value === "number" ? new Date(value) : value;
	return timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

export function classifyQueueHealth(
	queue: QueueHealthKey,
	backlogCount: number,
	oldestMessageAt: Date | null,
	staleJobCount: number,
	now: Date,
): QueueHealthStatus {
	if (queue === "outbound_dlq" && backlogCount > 0) return "attention";
	if (staleJobCount > 0) return "attention";
	if (backlogCount === 0) return "healthy";
	if (!oldestMessageAt) return "attention";
	const ageMs = Math.max(0, now.getTime() - oldestMessageAt.getTime());
	return ageMs >= ATTENTION_AFTER_MS ? "attention" : "delayed";
}

async function countStaleOutboundJobs(
	env: CloudflareEnv,
	now: Date,
): Promise<{ count: number; error: boolean }> {
	try {
		const db = getDb(env);
		const [row] = await db
			.select({ count: count() })
			.from(outboundJobs)
			.where(or(
				and(
					eq(outboundJobs.status, "queued"),
					lte(outboundJobs.updatedAt, new Date(now.getTime() - QUEUED_STALE_AFTER_MS)),
				),
				and(
					eq(outboundJobs.status, "processing"),
					lte(outboundJobs.updatedAt, new Date(now.getTime() - PROCESSING_STALE_AFTER_MS)),
				),
			));
		return { count: normalizeCount(row?.count ?? 0), error: false };
	} catch {
		return { count: 0, error: true };
	}
}

function publicSnapshot(
	row: typeof queueHealthSnapshots.$inferSelect,
	label: string,
): QueueHealthSnapshot {
	return {
		queue: row.queueKey,
		label,
		status: row.status,
		backlogCount: row.backlogCount,
		backlogBytes: row.backlogBytes,
		oldestMessageAt: row.oldestMessageAt?.toISOString() ?? null,
		staleJobCount: row.staleJobCount,
		detail: row.detail,
		checkedAt: row.checkedAt.toISOString(),
	};
}

export async function runQueueHealthCheck(
	env: CloudflareEnv,
	now = new Date(),
): Promise<QueueHealthSnapshot[]> {
	const db = getDb(env);
	const [staleJobs, metricResults] = await Promise.all([
		countStaleOutboundJobs(env, now),
		Promise.all(queueDefinitions.map(async (definition) => {
			try {
				return {
					definition,
					metrics: await definition.getBinding(env).metrics(),
					error: false,
				};
			} catch {
				return { definition, metrics: null, error: true };
			}
		})),
	]);

	const rows: Array<typeof queueHealthSnapshots.$inferInsert> = metricResults.map((result) => {
		const metrics = result.metrics;
		const backlogCount = normalizeCount(metrics?.backlogCount ?? 0);
		const backlogBytes = normalizeCount(metrics?.backlogBytes ?? 0);
		const oldestMessageAt = backlogCount > 0
			? normalizeTimestamp(metrics?.oldestMessageTimestamp)
			: null;
		const isOutbound = result.definition.key === "outbound";
		const staleJobCount = isOutbound ? staleJobs.count : 0;
		const unavailable = result.error || (isOutbound && staleJobs.error);
		const detail = result.error
			? "Queue metrics could not be read"
			: isOutbound && staleJobs.error
				? "Outbound job state could not be read"
				: null;

		return {
			queueKey: result.definition.key,
			status: unavailable
				? "unavailable"
				: classifyQueueHealth(
					result.definition.key,
					backlogCount,
					oldestMessageAt,
					staleJobCount,
					now,
				),
			backlogCount,
			backlogBytes,
			oldestMessageAt,
			staleJobCount,
			detail,
			checkedAt: now,
		};
	});

	for (const row of rows) {
		await db
			.insert(queueHealthSnapshots)
			.values(row)
			.onConflictDoUpdate({
				target: queueHealthSnapshots.queueKey,
				setWhere: lte(queueHealthSnapshots.checkedAt, row.checkedAt),
				set: {
					status: row.status,
					backlogCount: row.backlogCount,
					backlogBytes: row.backlogBytes,
					oldestMessageAt: row.oldestMessageAt,
					staleJobCount: row.staleJobCount,
					detail: row.detail,
					checkedAt: row.checkedAt,
				},
			});
	}

	return rows.map((row, index) =>
		publicSnapshot(
			row as typeof queueHealthSnapshots.$inferSelect,
			queueDefinitions[index].label,
		));
}

export async function readQueueHealthSnapshots(
	env: CloudflareEnv,
): Promise<QueueHealthSnapshot[]> {
	const rows = await getDb(env).select().from(queueHealthSnapshots);
	const byKey = new Map(rows.map((row) => [row.queueKey, row]));
	return queueDefinitions.flatMap((definition) => {
		const row = byKey.get(definition.key);
		return row ? [publicSnapshot(row, definition.label)] : [];
	});
}
