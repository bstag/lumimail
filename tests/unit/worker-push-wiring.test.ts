import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const worker = readFileSync(resolve(root, "worker.ts"), "utf8");
const config = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
const example = readFileSync(resolve(root, "wrangler.jsonc.example"), "utf8");

describe("private push Worker wiring", () => {
	it("routes isolated queue payloads and schedules reconciliation plus cleanup", () => {
		expect(worker).toMatch(/isPushQueueMessage/);
		expect(worker).toMatch(/processPushQueueMessage/);
		expect(worker).toMatch(/reconcilePushNotifications/);
		expect(worker).toMatch(/purgePushNotificationState/);
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
