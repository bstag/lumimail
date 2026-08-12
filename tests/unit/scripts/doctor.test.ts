import { describe, expect, it, vi } from "vitest";

import { buildLocalDoctorReport, runRemoteDoctor } from "../../../scripts/doctor.mjs";

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

const versionId = "721ad103-ec5a-4b0d-a48c-f664d6814451";

function remoteRunner(overrides: Record<string, string | Error> = {}) {
	const outputs: Record<string, string> = {
		"deployments status --config wrangler.jsonc --json": JSON.stringify({
			versions: [{ version_id: versionId, percentage: 100 }],
		}),
		[`versions view ${versionId} --config wrangler.jsonc --json`]: JSON.stringify({
			id: versionId,
			resources: {
				script: { handlers: ["fetch", "email", "queue", "scheduled"] },
				script_runtime: { compatibility_date: "2026-07-22" },
				bindings: [
					{ name: "DB", type: "d1", database_id: "d1-id" },
					{ name: "BUCKET", type: "r2_bucket", bucket_name: "lumimail-raw-prod" },
					{ name: "EMAIL", type: "send_email" },
					{ name: "INBOUND_QUEUE", type: "queue", queue_name: "lumimail-inbound-prod" },
					{ name: "OUTBOUND_QUEUE", type: "queue", queue_name: "lumimail-outbound-prod" },
					{ name: "OUTBOUND_DLQ_QUEUE", type: "queue", queue_name: "lumimail-outbound-dlq-prod" },
					{ name: "WORKER_SELF_REFERENCE", type: "service", service: "lumimail" },
					{ name: "CF_TOKEN", type: "secret_text" },
				],
			},
		}),
		"d1 info lumimail-prod --config wrangler.jsonc --json": JSON.stringify({ uuid: "d1-id", name: "lumimail-prod", num_tables: 30 }),
		"d1 migrations list DB --config wrangler.jsonc --remote": "No migrations to apply!",
		"r2 bucket info lumimail-raw-prod --config wrangler.jsonc --json": JSON.stringify({ name: "lumimail-raw-prod", object_count: "15" }),
		"queues list --config wrangler.jsonc --page 1": "lumimail-inbound-prod 1 1\nlumimail-outbound-prod 1 1\nlumimail-outbound-dlq-prod 1 1",
		"queues list --config wrangler.jsonc --page 2": "",
		"secret list --config wrangler.jsonc --format json": JSON.stringify([{ name: "CF_TOKEN", type: "secret_text" }]),
		"email routing list": "│ henriksen.dev │ zone-1 │ yes │",
		"email routing rules list henriksen.dev --zone-id zone-1": "Enabled: true\nActions: worker:lumimail\nCatch-all rule: enabled, action: worker:lumimail",
		"email sending settings henriksen.dev": "Email Sending for henriksen.dev:\nEnabled: true",
	};
	return vi.fn((args: string[]) => {
		const key = args.join(" ");
		const value = overrides[key] ?? outputs[key];
		if (value instanceof Error) throw value;
		if (value === undefined) throw new Error(`Unexpected command: ${key}`);
		return value;
	});
}

describe("runRemoteDoctor", () => {
	it("adds content-free read-only provider and smoke checks", () => {
		const runWrangler = remoteRunner();
		const report = runRemoteDoctor({
			localReport: buildLocalDoctorReport(inputs()),
			config: config(),
			origin: "https://mail.henriksen.dev",
			runWrangler,
			runSmoke: vi.fn(() => ({ passed: 6, total: 6 })),
		});

		expect(report.mode).toBe("remote");
		expect(report.ready).toBe(true);
		expect(report.summary).toEqual({ pass: report.checks.length - 1, fail: 0, warn: 1 });
		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "remote.cron", status: "warn" }),
			expect.objectContaining({ id: "remote.deployment", status: "pass", observed: 1 }),
			expect.objectContaining({ id: "remote.queues", status: "pass", observed: 3 }),
			expect.objectContaining({ id: "remote.secrets", status: "pass", observed: 1 }),
			expect.objectContaining({ id: "remote.smoke", status: "pass", observed: 6 }),
		]));
		expect(JSON.stringify(report)).not.toContain("zone-1");
		expect(JSON.stringify(report)).not.toContain("CF_TOKEN");
		expect(runWrangler.mock.calls.flatMap(([args]) => args)).not.toContain("execute");
	});

	it("aggregates malformed, incomplete, missing-secret, and failed-smoke results safely", () => {
		const report = runRemoteDoctor({
			localReport: buildLocalDoctorReport(inputs()),
			config: config(),
			origin: "https://mail.henriksen.dev",
			runWrangler: remoteRunner({
				"deployments status --config wrangler.jsonc --json": "not-json token-value",
				"d1 migrations list DB --config wrangler.jsonc --remote": "0029_pending.sql",
				"queues list --config wrangler.jsonc --page 2": "another-page",
				"secret list --config wrangler.jsonc --format json": "[]",
				"email sending settings henriksen.dev": new Error("provider leaked-secret-value"),
			}),
			runSmoke: vi.fn(() => ({ passed: 5, total: 6 })),
		});

		expect(report.ready).toBe(false);
		expect(report.checks.filter((entry: { status: string }) => entry.status === "fail").map((entry: { id: string }) => entry.id))
			.toEqual(expect.arrayContaining([
				"remote.deployment", "remote.migrations", "remote.queues", "remote.secrets", "remote.email-sending", "remote.smoke",
			]));
		expect(JSON.stringify(report)).not.toContain("token-value");
		expect(JSON.stringify(report)).not.toContain("leaked-secret-value");
	});

	it.each([
		["HTTP origin", "http://mail.henriksen.dev"],
		["origin path", "https://mail.henriksen.dev/admin"],
		["wrong host", "https://other.example.com"],
	])("refuses %s before provider access", (_label, origin) => {
		const runWrangler = remoteRunner();
		const report = runRemoteDoctor({
			localReport: buildLocalDoctorReport(inputs()), config: config(), origin, runWrangler,
			runSmoke: vi.fn(() => ({ passed: 6, total: 6 })),
		});
		expect(report.ready).toBe(false);
		expect(runWrangler).not.toHaveBeenCalled();
	});
});
