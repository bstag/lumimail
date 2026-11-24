import { expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
	expire: vi.fn(), webhook: vi.fn(), queue: vi.fn(), categorize: vi.fn(), rateLimit: vi.fn(),
	refreshToken: vi.fn(), pushReconcile: vi.fn(), pushPurge: vi.fn(), sync: vi.fn(), body: vi.fn(),
	sweep: vi.fn(), shouldSweep: vi.fn(), inboundPurge: vi.fn(),
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
		expect(log.mock.calls.flat()).toEqual(expect.arrayContaining([
			"Queue health check failed", "Push reconciliation failed", "OAuth storage purge failed",
		]));
	} finally {
		log.mockRestore();
	}
});
