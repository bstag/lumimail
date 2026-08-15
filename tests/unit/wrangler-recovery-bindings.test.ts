import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("recovery Worker binding isolation", () => {
	it("cannot receive production traffic or execute asynchronous mail work", () => {
		const config = JSON.parse(
			readFileSync("wrangler.recovery.jsonc", "utf8"),
		) as Record<string, unknown> & {
			d1_databases: Array<Record<string, string>>;
			r2_buckets: Array<Record<string, string>>;
			vars: Record<string, string>;
		};

		expect(config.name).toBe("lumimail-recovery-20260812");
		expect(config.workers_dev).toBe(true);
		expect(config.routes).toEqual([]);
		expect(config).not.toHaveProperty("triggers");
		expect(config).not.toHaveProperty("send_email");
		expect(config).not.toHaveProperty("queues");
		expect(config).not.toHaveProperty("services");
		expect(config.vars).toMatchObject({
			PUBLIC_APP_URL:
				"https://lumimail-recovery-20260812.blackstag.workers.dev",
			R2_SWEEP_ENABLED: "false",
			SEED_ENABLED: "false",
		});
		expect(config.d1_databases).toEqual([
			expect.objectContaining({
				binding: "DB",
				database_name: "lumimail-staging",
				database_id: "d239de97-37f1-4b9a-a664-f787ea60aa97",
			}),
		]);
		expect(config.r2_buckets).toEqual([
			{ binding: "BUCKET", bucket_name: "lumimail-raw-staging" },
		]);
	});
});
