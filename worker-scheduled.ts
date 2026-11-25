import { purgeMcpRefreshTokenUses } from "./worker-mcp-refresh";
import { getDb } from "./src/db";
import { reconcileCategorization } from "./src/lib/categorization/service";
import { repairExternalMessageBodies } from "./src/lib/email/external/body-repair";
import { reconcileExternalSyncJobs } from "./src/lib/email/external/sync-jobs";
import { purgeInboundDeliveries } from "./src/lib/email/inbound-delivery";
import { expireMessages } from "./src/lib/email/message-expiry";
import { processDueWebhooks } from "./src/lib/email/webhooks";
import { reconcilePushNotifications } from "./src/lib/push/queue";
import { purgePushNotificationState } from "./src/lib/push/retention";
import { runQueueHealthCheck } from "./src/lib/queue-health";
import { shouldRunSweep, sweepR2Orphans } from "./src/lib/r2-retention";
import { purgeExpiredRateLimits } from "./src/lib/rate-limit";
import { reconcileOutboundJobs } from "./src/lib/email/outbound/consumer";

const CORE_CRON = "* * * * *";
const WEBHOOK_CRON = "0-59 * * * *";
const BODY_REPAIR_CRON = "*/2 * * * *";

async function runTask(task: string, run: () => Promise<unknown>): Promise<void> {
	const started = Date.now();
	try {
		await run();
		console.info("Scheduled task", { task, outcome: "complete", elapsedMs: Date.now() - started });
	} catch (error) {
		console.warn("Scheduled task", {
			task, outcome: "failed", elapsedMs: Date.now() - started,
			errorType: error instanceof Error ? error.name : typeof error,
		});
	}
}

export async function runScheduledMaintenance(
	scheduledTime: number,
	env: CloudflareEnv,
	purgeOAuth: () => Promise<unknown>,
	cron = CORE_CRON,
): Promise<void> {
	const isolated = env.ISOLATED_MAINTENANCE_CRONS === "true";
	if (cron === WEBHOOK_CRON) return runTask("Webhook delivery", () => processDueWebhooks(env));
	if (cron === BODY_REPAIR_CRON) return runBodyRepair(env);
	if (cron !== CORE_CRON) throw new Error(`Unrecognized maintenance schedule: ${cron}`);

	// Expiry is a single indexed update and runs before higher-CPU work.
	await runTask("Message expiry deferred", () => expireMessages(getDb(env)));
	if (!isolated) await runTask("Webhook scheduling failed", () => processDueWebhooks(env));
	await runTask("Outbound reconciliation", () => reconcileOutboundJobs(env, new Date(scheduledTime)));
	await runTask("Queue health check failed", () => runQueueHealthCheck(env));
	await runTask("Mail categorization reconciliation deferred", () => reconcileCategorization(env));
	await runTask("Rate limit cleanup failed", () => purgeExpiredRateLimits(env));
	await runTask("MCP replay cleanup failed", () => purgeMcpRefreshTokenUses(env));
	await runTask("Push reconciliation failed", () => reconcilePushNotifications(env));
	await runTask("Push retention failed", () => purgePushNotificationState(env));
	await runTask("External sync reconciliation failed", () => reconcileExternalSyncJobs(env));
	await runTask("OAuth storage purge failed", purgeOAuth);

	const now = new Date(scheduledTime);
	if (scheduledTime % 86_400_000 === 0) {
		await runTask("Inbound delivery cleanup failed", () => purgeInboundDeliveries(env, now));
	}
	if (env.R2_SWEEP_ENABLED === "true" && shouldRunSweep(scheduledTime)) {
		await runTask("R2 retention sweep failed", async () => {
			const result = await sweepR2Orphans(env, now);
			if (result.deleted > 0 || result.remaining > 0) console.info("R2 retention sweep", result);
		});
	}

	if (!isolated) await runBodyRepair(env);
}

function runBodyRepair(env: CloudflareEnv) {
	return runTask("External body repair deferred", async () => {
		const repair = await repairExternalMessageBodies(env);
		if (repair.repaired > 0 || repair.abandoned > 0) console.info("External body repair", repair);
	});
}
