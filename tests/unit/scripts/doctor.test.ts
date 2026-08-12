import { describe, expect, it } from "vitest";

import { buildLocalDoctorReport } from "../../../scripts/doctor.mjs";

function config() {
	return {
		name: "lumimail",
		main: "./worker.ts",
		compatibility_date: "2026-07-22",
		routes: [{ pattern: "mail.henriksen.dev", custom_domain: true }],
		assets: { binding: "ASSETS", directory: ".open-next/assets" },
		images: { binding: "IMAGES" },
		services: [{ binding: "WORKER_SELF_REFERENCE", service: "lumimail" }],
		vars: {
			CF_ACCOUNT_ID: "account-id-must-not-appear",
			CF_EMAIL_WORKER_NAME: "lumimail",
			MAIL_PROVIDER: "cloudflare",
			PUBLIC_APP_URL: "https://mail.henriksen.dev",
			PASSWORD_RESET_FROM: "noreply@henriksen.dev",
			R2_SWEEP_ENABLED: "true",
			SEED_ENABLED: "true",
		},
		triggers: { crons: ["* * * * *"] },
		send_email: [{ name: "EMAIL" }],
		d1_databases: [{ binding: "DB", database_name: "lumimail-prod", database_id: "d1-id" }],
		r2_buckets: [{ binding: "BUCKET", bucket_name: "lumimail-raw-prod" }],
		queues: {
			producers: [
				{ binding: "INBOUND_QUEUE", queue: "lumimail-inbound-prod" },
				{ binding: "OUTBOUND_QUEUE", queue: "lumimail-outbound-prod" },
				{ binding: "OUTBOUND_DLQ_QUEUE", queue: "lumimail-outbound-dlq-prod" },
			],
			consumers: [
				{ queue: "lumimail-inbound-prod" },
				{ queue: "lumimail-outbound-prod", dead_letter_queue: "lumimail-outbound-dlq-prod" },
				{ queue: "lumimail-outbound-dlq-prod" },
			],
		},
	};
}

function inputs(overrides: Record<string, unknown> = {}) {
	return {
		nodeVersion: "22.18.0",
		packageManifest: { name: "email-platform", engines: { node: ">=22" } },
		config: config(),
		migrationNames: ["0000_init.sql", "0001_next.sql", "0002_more.sql"],
		requiredPaths: {
			"worker.entry": true,
			"smoke.script": true,
			"recovery.manifest": true,
		},
		...overrides,
	};
}

describe("buildLocalDoctorReport", () => {
	it("returns deterministic passing checks for the complete production shape", () => {
		const report = buildLocalDoctorReport(inputs());
		expect(report.product).toBe("lumimail");
		expect(report.mode).toBe("local");
		expect(report.summary).toEqual({ pass: report.checks.length, fail: 0, warn: 0 });
		expect(report.ready).toBe(true);
		expect(report.checks.map((check: { id: string }) => check.id)).toEqual(
			[...report.checks.map((check: { id: string }) => check.id)].sort(),
		);
		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "runtime.node", status: "pass", observed: "22.18.0" }),
			expect.objectContaining({ id: "migrations.sequence", status: "pass", observed: "0000..0002" }),
			expect.objectContaining({ id: "bindings.queues", status: "pass", observed: 3 }),
		]));
	});

	it("aggregates independent failures and does not expose config values", () => {
		const broken = config();
		broken.name = "other";
		broken.routes = [];
		broken.queues.producers.pop();
		const report = buildLocalDoctorReport(inputs({
			nodeVersion: "20.17.0",
			config: broken,
			migrationNames: ["0000_init.sql", "0002_gap.sql", "0002_duplicate.sql"],
			requiredPaths: { "worker.entry": false },
		}));

		expect(report.ready).toBe(false);
		expect(report.summary.fail).toBeGreaterThanOrEqual(5);
		expect(report.checks.filter((check: { status: string }) => check.status === "fail").map((check: { id: string }) => check.id))
			.toEqual(expect.arrayContaining(["runtime.node", "config.worker", "config.routes", "bindings.queues", "migrations.sequence", "path.worker.entry"]));
		expect(JSON.stringify(report)).not.toContain("account-id-must-not-appear");
		expect(JSON.stringify(report)).not.toContain("noreply@henriksen.dev");
	});

	it.each([
		["missing config", { config: undefined }],
		["malformed engine", { packageManifest: { name: "email-platform", engines: { node: "latest" } } }],
		["empty migrations", { migrationNames: [] }],
	])("fails closed for %s", (_label, override) => {
		const report = buildLocalDoctorReport(inputs(override));
		expect(report.ready).toBe(false);
		expect(report.summary.fail).toBeGreaterThan(0);
	});

	it("freezes the report and does not mutate caller inputs", () => {
		const source = inputs();
		const original = structuredClone(source);
		const report = buildLocalDoctorReport(source);
		expect(source).toEqual(original);
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.checks)).toBe(true);
		expect(Object.isFrozen(report.checks[0])).toBe(true);
	});
});
