import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseJsonc } from "../helpers/jsonc";

/** True if any object anywhere in the tree carries `"remote": true`. */
function hasRemoteTrue(node: unknown): boolean {
	if (Array.isArray(node)) return node.some(hasRemoteTrue);
	if (node && typeof node === "object") {
		return Object.entries(node).some(
			([key, value]) => (key === "remote" && value === true) || hasRemoteTrue(value),
		);
	}
	return false;
}

type WranglerEnv = {
	routes?: unknown[];
	send_email?: Array<{ name?: string }>;
	kv_namespaces?: Array<{ binding?: string }>;
	d1_databases?: Array<{ binding?: string }>;
	r2_buckets?: Array<{ binding?: string }>;
	queues?: {
		producers?: Array<{ binding?: string; queue?: string }>;
		consumers?: Array<{ queue?: string; dead_letter_queue?: string }>;
	};
	env?: Record<string, WranglerEnv>;
};

function readJsonc(file: string): WranglerEnv {
	return parseJsonc(readFileSync(resolve(process.cwd(), file), "utf8")) as WranglerEnv;
}

/**
 * The binding contract every deployable environment must satisfy: the email
 * binding is named EMAIL, core storage bindings keep their names, the three
 * queue producers exist, and every produced queue (plus any dead-letter
 * target) has a consumer wired to it.
 */
function expectBindingContract(env: WranglerEnv) {
	expect(env.send_email?.map((binding) => binding.name)).toContain("EMAIL");
	expect(env.d1_databases?.map((db) => db.binding)).toContain("DB");
	expect(env.kv_namespaces?.map((namespace) => namespace.binding)).toContain("OAUTH_KV");
	expect(env.r2_buckets?.map((bucket) => bucket.binding)).toContain("BUCKET");

	const producers = env.queues?.producers ?? [];
	expect(producers.map((producer) => producer.binding).sort()).toEqual([
		"EXTERNAL_SYNC_DLQ_QUEUE",
		"EXTERNAL_SYNC_QUEUE",
		"INBOUND_QUEUE",
		"OUTBOUND_DLQ_QUEUE",
		"OUTBOUND_QUEUE",
		"PUSH_DLQ_QUEUE",
		"PUSH_QUEUE",
	]);

	const producedQueues = producers.map((producer) => producer.queue).sort();
	const consumers = env.queues?.consumers ?? [];
	const consumedQueues = consumers.map((consumer) => consumer.queue).sort();
	expect(consumedQueues).toEqual(producedQueues);

	const deadLetterQueues = consumers
		.map((consumer) => consumer.dead_letter_queue)
		.filter((queue): queue is string => queue !== undefined);
	// Outbound, push, and external-sync consumers route failures to isolated DLQs, and each DLQ
	// is itself consumed by its recovery path.
	expect(deadLetterQueues).toHaveLength(3);
	for (const queue of deadLetterQueues) expect(consumedQueues).toContain(queue);
}

describe("Wrangler local binding contract", () => {
	it("keeps the deployed binding contract in wrangler.jsonc", () => {
		const config = readJsonc("wrangler.jsonc");

		expectBindingContract(config);
		// No binding may opt into a remote resource during local dev: browser
		// tests and `wrangler dev` must stay hermetic.
		expect(hasRemoteTrue(config)).toBe(false);

		// Every additional environment (e.g. staging) redeclares the full
		// contract, because Wrangler replaces binding arrays per environment
		// rather than merging them.
		for (const envConfig of Object.values(config.env ?? {})) {
			expectBindingContract(envConfig);
			expect(envConfig.routes).toEqual([]);
		}
	});

	it("keeps the deployed binding contract in wrangler.jsonc.example", () => {
		const exampleConfig = readJsonc("wrangler.jsonc.example");

		expectBindingContract(exampleConfig);
		expect(hasRemoteTrue(exampleConfig)).toBe(false);
		for (const envConfig of Object.values(exampleConfig.env ?? {})) {
			expectBindingContract(envConfig);
			expect(envConfig.routes).toEqual([]);
		}
	});

	it("keeps browser tests wired to the local server harness", () => {
		const playwrightConfig = readFileSync(
			resolve(process.cwd(), "playwright.config.ts"),
			"utf8",
		);
		const serverSetup = readFileSync(resolve(process.cwd(), "tests/e2e-server.ts"), "utf8");
		const nextConfig = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

		expect(playwrightConfig).toContain('globalSetup: "./tests/e2e-server.ts"');
		expect(serverSetup).toContain("XDG_CONFIG_HOME");
		expect(serverSetup).toContain('.wrangler", "playwright-config');
		expect(serverSetup).toContain("LUMIMAIL_CLOUDFLARE_DEV");
		expect(serverSetup).toContain('npm_lifecycle_event === "e2e:local"');
		expect(serverSetup).toContain('"taskkill"');
		expect(nextConfig).toContain('process.env.LUMIMAIL_CLOUDFLARE_DEV !== "false"');
	});

	it("migrates the persisted local D1 database before seeding real-backend E2E fixtures", () => {
		const packageJson = JSON.parse(
			readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
		) as { scripts?: Record<string, string> };
		const command = packageJson.scripts?.["e2e:local"] ?? "";

		const migrateIndex = command.indexOf("npm run db:migrate:local");
		const seedIndex = command.indexOf("node scripts/seed-e2e.mjs");
		expect(migrateIndex).toBeGreaterThanOrEqual(0);
		expect(seedIndex).toBeGreaterThan(migrateIndex);
	});

	it("exposes the repeatable deployment smoke gate as an npm command", () => {
		const packageJson = JSON.parse(
			readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
		) as { scripts?: Record<string, string> };

		expect(packageJson.scripts?.smoke).toBe("node scripts/smoke.mjs");
	});
});
