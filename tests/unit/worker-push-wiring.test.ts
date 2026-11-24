import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const worker = readFileSync(resolve(root, "worker.ts"), "utf8");
const scheduled = readFileSync(resolve(root, "worker-scheduled.ts"), "utf8");
const config = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
const example = readFileSync(resolve(root, "wrangler.jsonc.example"), "utf8");

it("runs pending webhook jobs from the scheduler outside mail consumers", () => {
	expect(worker).toContain("runScheduledMaintenance(controller.scheduledTime, env");
	expect(scheduled).toContain("() => processDueWebhooks(env)");
	expect(worker.slice(worker.indexOf("async queue("), worker.indexOf("async scheduled("))).not.toContain("processDueWebhooks");
});

it("continues durable mail categorization through the existing minute scheduler", () => {
	expect(scheduled).toContain("() => reconcileCategorization(env)");
	expect(scheduled).toContain("Mail categorization reconciliation deferred");
	for (const source of [config, example]) expect(source).toContain("* * * * *");
});

describe("private push Worker wiring", () => {
	it("routes isolated queue payloads and schedules reconciliation plus cleanup", () => {
		expect(worker).toMatch(/isPushQueueMessage/);
		expect(worker).toMatch(/processPushQueueMessage/);
		expect(scheduled).toMatch(/reconcilePushNotifications/);
		expect(scheduled).toMatch(/purgePushNotificationState/);
	});

	it.each([config, example])("declares separate production and staging push queues", (source) => {
		expect(source).toContain('"binding": "PUSH_QUEUE"');
		expect(source).toContain('"binding": "PUSH_DLQ_QUEUE"');
		expect(source).toMatch(/lumimail-push[^\s"]*/);
		expect(source).toMatch(/lumimail-push-dlq[^\s"]*/);
		expect(source).toMatch(/dead_letter_queue"\s*:\s*"lumimail-push-dlq/);
	});

	it("documents VAPID values as secrets rather than plaintext vars", () => {
		expect(example).toMatch(/wrangler secret put VAPID_PUBLIC_KEY/);
		expect(example).toMatch(/wrangler secret put VAPID_PRIVATE_KEY/);
		expect(example).toMatch(/wrangler secret put VAPID_SUBJECT/);
		expect(example).not.toMatch(/"vars"[\s\S]*"VAPID_PRIVATE_KEY"\s*:/);
	});
});

describe("external sync Worker wiring", () => {
	it("routes durable external sync jobs and schedules reconciliation", () => {
		expect(worker).toMatch(/isExternalSyncQueueMessage/);
		expect(worker).toMatch(/processExternalSyncQueue/);
		expect(scheduled).toMatch(/reconcileExternalSyncJobs/);
	});

	it("expires filtered mail first, so a heavier step that runs out of CPU cannot skip it", () => {
		const expiry = scheduled.indexOf("expireMessages(getDb(env))");
		expect(expiry).toBeGreaterThan(-1);
		for (const later of ["processDueWebhooks(env)", "reconcileCategorization(env)", "repairExternalMessageBodies(env)"]) {
			expect(scheduled.indexOf(later), later).toBeGreaterThan(expiry);
		}
	});

	it("schedules the external body repair behind its own failure guard", () => {
		expect(scheduled).toMatch(/runTask\("External body repair deferred", async \(\) => \{\s*const repair = await repairExternalMessageBodies\(env\);/);
	});

	it.each([config, example])("declares isolated external sync and dead-letter queues", (source) => {
		expect(source).toContain('"binding": "EXTERNAL_SYNC_QUEUE"');
		expect(source).toContain('"binding": "EXTERNAL_SYNC_DLQ_QUEUE"');
		expect(source).toMatch(/dead_letter_queue"\s*:\s*"lumimail-external-sync-dlq/);
	});
});
