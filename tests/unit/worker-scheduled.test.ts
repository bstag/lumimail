import { expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
	expire: vi.fn(), webhook: vi.fn(), queue: vi.fn(), categorize: vi.fn(), rateLimit: vi.fn(),
	refreshToken: vi.fn(), pushReconcile: vi.fn(), pushPurge: vi.fn(), sync: vi.fn(), body: vi.fn(),
	sweep: vi.fn(), shouldSweep: vi.fn(), inboundPurge: vi.fn(), outbound: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/email/message-expiry", () => ({ expireMessages: jobs.expire }));
vi.mock("@/lib/email/webhooks", () => ({ processDueWebhooks: jobs.webhook }));
vi.mock("@/lib/queue-health", () => ({ runQueueHealthCheck: jobs.queue }));
vi.mock("@/lib/categorization/service", () => ({ reconcileCategorization: jobs.categorize }));
vi.mock("@/lib/rate-limit", () => ({ purgeExpiredRateLimits: jobs.rateLimit }));
vi.mock("../../worker-mcp-refresh", () => ({ purgeMcpRefreshTokenUses: jobs.refreshToken }));
vi.mock("@/lib/push/queue", () => ({ reconcilePushNotifications: jobs.pushReconcile }));
vi.mock("@/lib/push/retention", () => ({ purgePushNotificationState: jobs.pushPurge }));
vi.mock("@/lib/email/external/sync-jobs", () => ({ reconcileExternalSyncJobs: jobs.sync }));
vi.mock("@/lib/email/external/body-repair", () => ({ repairExternalMessageBodies: jobs.body }));
vi.mock("@/lib/r2-retention", () => ({ sweepR2Orphans: jobs.sweep, shouldRunSweep: jobs.shouldSweep }));
vi.mock("@/lib/email/inbound-delivery", () => ({ purgeInboundDeliveries: jobs.inboundPurge }));
vi.mock("@/lib/email/outbound/consumer", () => ({ reconcileOutboundJobs: jobs.outbound }));

import { runScheduledMaintenance } from "../../worker-scheduled";

it("runs expiry first and continues independent maintenance after failures", async () => {
	const log = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		jobs.queue.mockRejectedValueOnce(new Error("queue health write failed"));
		jobs.pushReconcile.mockRejectedValueOnce(new Error("push reconciliation failed"));
		jobs.body.mockResolvedValue({ repaired: 0, abandoned: 0 });
		jobs.shouldSweep.mockReturnValue(true);
		jobs.sweep.mockResolvedValue({ deleted: 0, remaining: 0 });
		const purgeOAuth = vi.fn().mockRejectedValueOnce(new Error("OAuth purge failed"));
		const scheduledTime = Date.UTC(2026, 10, 24);
		await runScheduledMaintenance(scheduledTime, { R2_SWEEP_ENABLED: "true" } as CloudflareEnv, purgeOAuth);
		expect(jobs.expire).toHaveBeenCalledBefore(jobs.webhook);
		expect(jobs.queue).toHaveBeenCalledBefore(jobs.categorize);
		expect(jobs.pushPurge).toHaveBeenCalled();
		expect(jobs.sync).toHaveBeenCalled();
		expect(jobs.inboundPurge).toHaveBeenCalled();
		expect(jobs.sweep).toHaveBeenCalled();
		expect(log.mock.calls.map(([, details]) => details.task)).toEqual(expect.arrayContaining([
			"Queue health check failed", "Push reconciliation failed", "OAuth storage purge failed",
		]));
	} finally {
		log.mockRestore();
	}
});

it("runs webhook delivery and body repair only in their own invocations after opt-in", async () => {
	vi.clearAllMocks();
	const env = { ISOLATED_MAINTENANCE_CRONS: "true" } as CloudflareEnv;
	const now = Date.UTC(2026, 10, 24, 0, 1);
	const oauth = vi.fn();
	await runScheduledMaintenance(now, env, oauth);
	expect(jobs.outbound).toHaveBeenCalledWith(env, new Date(now));
	expect(jobs.webhook).not.toHaveBeenCalled();
	expect(jobs.body).not.toHaveBeenCalled();
	await runScheduledMaintenance(now, env, oauth, "0-59 * * * *");
	expect(jobs.webhook).toHaveBeenCalledOnce();
	await runScheduledMaintenance(now, env, oauth, "*/2 * * * *");
	expect(jobs.body).toHaveBeenCalledOnce();
	expect(jobs.expire).toHaveBeenCalledOnce();
});
