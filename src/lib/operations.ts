import packageManifest from "../../package.json";
import schemaPolicy from "../../release.schema.json";

import { readQueueHealthSnapshots, type QueueHealthSnapshot } from "@/lib/queue-health";
import { reportR2Retention, type RetentionReport } from "@/lib/r2-retention";

export type OperationsStatus = "healthy" | "attention" | "unavailable";
export type OperationsQueueStatus = OperationsStatus | "unknown";

export type OperationsOverview = {
	status: OperationsStatus;
	observedAt: string;
	application: { version: string; schema: string };
	queues: {
		status: OperationsQueueStatus;
		checkedAt: string | null;
		queueCount: number;
		attentionCount: number;
		unavailableCount: number;
		backlogCount: number;
		backlogBytes: number;
		staleJobCount: number;
	};
	retention: {
		status: OperationsStatus;
		scanned: number;
		orphanCount: number;
		orphanBytes: number;
		oldestOrphanAt: string | null;
	};
};

type OverviewInput = {
	version: string;
	schema: string;
	observedAt: string;
	queues: QueueHealthSnapshot[] | null;
	retention: RetentionReport | null;
};

function freezeOverview(report: OperationsOverview): Readonly<OperationsOverview> {
	Object.freeze(report.application);
	Object.freeze(report.queues);
	Object.freeze(report.retention);
	return Object.freeze(report);
}

export function buildOperationsOverview(input: OverviewInput): Readonly<OperationsOverview> {
	const unavailableCount = input.queues?.filter((queue) => queue.status === "unavailable").length ?? 0;
	const attentionCount = input.queues?.filter((queue) =>
		queue.status === "attention" || queue.status === "delayed").length ?? 0;
	const queueStatus: OperationsQueueStatus = input.queues === null
		? "unavailable"
		: input.queues.length === 0
			? "unknown"
			: unavailableCount > 0
				? "unavailable"
				: attentionCount > 0 ? "attention" : "healthy";
	const retentionStatus: OperationsStatus = input.retention === null
		? "unavailable"
		: input.retention.orphans > 0 ? "attention" : "healthy";
	const status: OperationsStatus = queueStatus === "unavailable" || retentionStatus === "unavailable"
		? "unavailable"
		: queueStatus === "attention" || queueStatus === "unknown" || retentionStatus === "attention"
			? "attention"
			: "healthy";
	const checkedAt = input.queues?.reduce<string | null>((latest, queue) =>
		!latest || queue.checkedAt > latest ? queue.checkedAt : latest, null) ?? null;

	return freezeOverview({
		status,
		observedAt: input.observedAt,
		application: { version: input.version, schema: input.schema },
		queues: {
			status: queueStatus,
			checkedAt,
			queueCount: input.queues?.length ?? 0,
			attentionCount,
			unavailableCount,
			backlogCount: input.queues?.reduce((total, queue) => total + queue.backlogCount, 0) ?? 0,
			backlogBytes: input.queues?.reduce((total, queue) => total + queue.backlogBytes, 0) ?? 0,
			staleJobCount: input.queues?.reduce((total, queue) => total + queue.staleJobCount, 0) ?? 0,
		},
		retention: {
			status: retentionStatus,
			scanned: input.retention?.scanned ?? 0,
			orphanCount: input.retention?.orphans ?? 0,
			orphanBytes: input.retention?.bytes ?? 0,
			oldestOrphanAt: input.retention?.oldestUploadedAt ?? null,
		},
	});
}

type OperationsDependencies = {
	readQueues: typeof readQueueHealthSnapshots;
	readRetention: typeof reportR2Retention;
	version: string;
	schema: string;
};

const defaults: OperationsDependencies = {
	readQueues: readQueueHealthSnapshots,
	readRetention: reportR2Retention,
	version: packageManifest.version,
	// F81 currently requires an exact compatibility policy. Widening that range must
	// replace this with an installed-schema read rather than presenting maximum as current.
	schema: schemaPolicy.maximum,
};

export async function readOperationsOverview(
	env: CloudflareEnv,
	now = new Date(),
	dependencies: OperationsDependencies = defaults,
): Promise<Readonly<OperationsOverview>> {
	const [queues, retention] = await Promise.allSettled([
		dependencies.readQueues(env),
		dependencies.readRetention(env),
	]);
	return buildOperationsOverview({
		version: dependencies.version,
		schema: dependencies.schema,
		observedAt: now.toISOString(),
		queues: queues.status === "fulfilled" ? queues.value : null,
		retention: retention.status === "fulfilled" ? retention.value : null,
	});
}
