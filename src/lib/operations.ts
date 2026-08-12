import packageManifest from "../../package.json";
import schemaPolicy from "../../release.schema.json";

import { readQueueHealthSnapshots, type QueueHealthSnapshot } from "@/lib/queue-health";
import { reportR2Retention, type RetentionReport } from "@/lib/r2-retention";

export type OperationsStatus = "healthy" | "attention" | "unavailable";
export type OperationsQueueStatus = OperationsStatus | "unknown";
export type RuntimeProvider = "cloudflare" | "resend" | "unsupported";

export type RuntimeReadiness = {
	status: OperationsStatus;
	provider: RuntimeProvider;
	requiredCount: number;
	readyCount: number;
	missingCount: number;
	storage: boolean;
	queues: boolean;
	delivery: boolean;
	service: boolean;
	assets: boolean;
};

export type OperationsOverview = {
	status: OperationsStatus;
	observedAt: string;
	application: { version: string; schema: string };
	readiness: RuntimeReadiness;
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
	readiness: RuntimeReadiness | null;
	queues: QueueHealthSnapshot[] | null;
	retention: RetentionReport | null;
};

function freezeOverview(report: OperationsOverview): Readonly<OperationsOverview> {
	Object.freeze(report.application);
	Object.freeze(report.readiness);
	Object.freeze(report.queues);
	Object.freeze(report.retention);
	return Object.freeze(report);
}

export function buildOperationsOverview(input: OverviewInput): Readonly<OperationsOverview> {
	const readiness = input.readiness ?? Object.freeze({
		status: "unavailable" as const,
		provider: "unsupported" as const,
		requiredCount: 9,
		readyCount: 0,
		missingCount: 9,
		storage: false,
		queues: false,
		delivery: false,
		service: false,
		assets: false,
	});
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
	const status: OperationsStatus = readiness.status === "unavailable" || queueStatus === "unavailable" || retentionStatus === "unavailable"
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
		readiness,
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
	readReadiness: typeof readRuntimeReadiness;
	version: string;
	schema: string;
};

export function readRuntimeReadiness(env: CloudflareEnv): Readonly<RuntimeReadiness> {
	const configuredProvider = (env.MAIL_PROVIDER ?? "cloudflare").trim().toLowerCase();
	const provider: RuntimeProvider = configuredProvider === "cloudflare" || configuredProvider === "resend"
		? configuredProvider
		: "unsupported";
	const storageBindings = [env.DB, env.BUCKET].filter(Boolean).length;
	const queueBindings = [env.INBOUND_QUEUE, env.OUTBOUND_QUEUE, env.OUTBOUND_DLQ_QUEUE].filter(Boolean).length;
	const storage = storageBindings === 2;
	const queuesReady = queueBindings === 3;
	const delivery = provider === "cloudflare"
		? Boolean(env.EMAIL)
		: provider === "resend" && Boolean(env.RESEND_API_KEY?.trim());
	const service = Boolean(env.WORKER_SELF_REFERENCE);
	const assetBindings = [env.ASSETS, env.IMAGES].filter(Boolean).length;
	const assets = assetBindings === 2;
	const readyCount = storageBindings + queueBindings + Number(delivery) + Number(service) + assetBindings;
	const requiredCount = 9;
	return Object.freeze({
		status: readyCount === requiredCount ? "healthy" : "unavailable",
		provider,
		requiredCount,
		readyCount,
		missingCount: requiredCount - readyCount,
		storage,
		queues: queuesReady,
		delivery,
		service,
		assets,
	});
}

const defaults: OperationsDependencies = {
	readQueues: readQueueHealthSnapshots,
	readRetention: reportR2Retention,
	readReadiness: readRuntimeReadiness,
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
	const [queues, retention, readiness] = await Promise.allSettled([
		dependencies.readQueues(env),
		dependencies.readRetention(env),
		dependencies.readReadiness(env),
	]);
	return buildOperationsOverview({
		version: dependencies.version,
		schema: dependencies.schema,
		observedAt: now.toISOString(),
		readiness: readiness.status === "fulfilled" ? readiness.value : null,
		queues: queues.status === "fulfilled" ? queues.value : null,
		retention: retention.status === "fulfilled" ? retention.value : null,
	});
}
