import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
	buildLocalDoctorReport,
	parseDoctorArgs,
	parseWranglerSession,
	runRemoteDoctor,
} from "../../../scripts/doctor.mjs";
import { SMOKE_CHECK_COUNT } from "../../../scripts/operations-evidence.mjs";
import { parseJsonc } from "../../helpers/jsonc";

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
				{ binding: "PUSH_QUEUE", queue: "lumimail-push-prod" },
				{ binding: "PUSH_DLQ_QUEUE", queue: "lumimail-push-dlq-prod" },
			],
			consumers: [
				{ queue: "lumimail-inbound-prod" },
				{ queue: "lumimail-outbound-prod", dead_letter_queue: "lumimail-outbound-dlq-prod" },
				{ queue: "lumimail-outbound-dlq-prod" },
				{ queue: "lumimail-push-prod", dead_letter_queue: "lumimail-push-dlq-prod" },
				{ queue: "lumimail-push-dlq-prod" },
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

describe("parseDoctorArgs", () => {
	it.each([
		["the documented flag form", ["--remote", "https://mail.henriksen.dev"]],
		["a flag form with other options first", ["--json", "--remote", "https://mail.henriksen.dev"]],
		// npm and PowerShell can both swallow `--remote` from `npm run doctor -- --remote <url>`,
		// which previously downgraded the run to local mode without saying so.
		["a bare origin left after the flag was stripped", ["https://mail.henriksen.dev"]],
	])("selects remote mode from %s", (_label, argv) => {
		expect(parseDoctorArgs(argv)).toEqual(expect.objectContaining({
			remote: true, origin: "https://mail.henriksen.dev",
		}));
	});

	it.each([
		["no arguments", []],
		["only the json flag", ["--json"]],
	])("stays local for %s", (_label, argv) => {
		expect(parseDoctorArgs(argv)).toEqual(expect.objectContaining({ remote: false, origin: undefined }));
	});

	it.each([
		["a flag with no value", ["--remote"]],
		["a flag followed by another option", ["--remote", "--json"]],
	])("keeps remote mode without an origin for %s so the run fails instead of silently downgrading", (_label, argv) => {
		expect(parseDoctorArgs(argv)).toEqual(expect.objectContaining({ remote: true, origin: undefined }));
	});

	it("reports the json flag independently of mode", () => {
		expect(parseDoctorArgs(["--json"]).json).toBe(true);
		expect(parseDoctorArgs(["--remote", "https://mail.henriksen.dev"]).json).toBe(false);
		expect(parseDoctorArgs(undefined).json).toBe(false);
	});
});

describe("parseWranglerSession", () => {
	const now = Date.parse("2026-08-15T12:00:00.000Z");
	const profile = (overrides = "") => [
		'oauth_token = "session-token-value"',
		'expiration_time = "2026-08-15T13:00:00.000Z"',
		'refresh_token = "refresh-token-value"',
		'scopes = [ "account:read" ]',
		overrides,
	].join("\n");

	it("returns the access token from an unexpired profile", () => {
		expect(parseWranglerSession(profile(), now)).toBe("session-token-value");
	});

	it("returns the token when the profile records no expiry", () => {
		expect(parseWranglerSession('oauth_token = "session-token-value"', now)).toBe("session-token-value");
	});

	it.each([
		["an expired session", 'oauth_token = "session-token-value"\nexpiration_time = "2026-08-15T11:59:59.000Z"'],
		["an empty token", 'oauth_token = ""\nexpiration_time = "2026-08-15T13:00:00.000Z"'],
		["a profile with no token", 'refresh_token = "refresh-token-value"'],
		["a non-string input", undefined],
	])("returns null for %s so it reports as an absent credential", (_label, text) => {
		expect(parseWranglerSession(text, now)).toBeNull();
	});

	it("never returns the refresh token", () => {
		expect(parseWranglerSession(profile(), now)).not.toContain("refresh-token-value");
	});
});

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
			expect.objectContaining({ id: "bindings.queues", status: "pass", observed: 5 }),
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

	// The fixture above can drift away from the deployed contract, which is exactly how
	// the queue gate came to fail on a correct wrangler.jsonc. Build the same report from
	// the real committed configuration so an added binding cannot pass unnoticed.
	it("reports the committed production configuration as ready", () => {
		const config = parseJsonc(readFileSync(resolve("wrangler.jsonc"), "utf8")) as Record<string, unknown>;
		const packageManifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
		const report = buildLocalDoctorReport({
			nodeVersion: process.versions.node,
			packageManifest,
			config,
			migrationNames: readdirSync(resolve("drizzle/migrations")).filter((name) => name.endsWith(".sql")),
			requiredPaths: {
				"worker.entry": true,
				"smoke.script": true,
				"recovery.manifest": true,
			},
		});

		expect(report.checks.filter((check: { status: string }) => check.status !== "pass")).toEqual([]);
		expect(report.ready).toBe(true);
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
					{ name: "PUSH_QUEUE", type: "queue", queue_name: "lumimail-push-prod" },
					{ name: "PUSH_DLQ_QUEUE", type: "queue", queue_name: "lumimail-push-dlq-prod" },
					{ name: "WORKER_SELF_REFERENCE", type: "service", service: "lumimail" },
					{ name: "CF_TOKEN", type: "secret_text" },
				],
			},
		}),
		"d1 info lumimail-prod --config wrangler.jsonc --json": JSON.stringify({ uuid: "d1-id", name: "lumimail-prod", num_tables: 30 }),
		"d1 migrations list DB --config wrangler.jsonc --remote": "No migrations to apply!",
		"r2 bucket info lumimail-raw-prod --config wrangler.jsonc --json": JSON.stringify({ name: "lumimail-raw-prod", object_count: "15" }),
		"queues list --config wrangler.jsonc --page 1": [
			"lumimail-inbound-prod 1 1",
			"lumimail-outbound-prod 1 1",
			"lumimail-outbound-dlq-prod 1 1",
			"lumimail-push-prod 1 1",
			"lumimail-push-dlq-prod 1 1",
		].join("\n"),
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

function liveSchedules(crons: string[] = ["* * * * *"]) {
	return {
		success: true,
		errors: [],
		messages: [],
		result: {
			schedules: crons.map((cron) => ({
				cron,
				created_on: "2026-07-22T00:00:00Z",
				modified_on: "2026-07-22T00:00:00Z",
			})),
		},
	};
}

function remoteInputs(overrides: Record<string, unknown> = {}) {
	return {
		localReport: buildLocalDoctorReport(inputs()),
		config: config(),
		origin: "https://mail.henriksen.dev",
		runWrangler: remoteRunner(),
		runSmoke: vi.fn(() => ({ passed: SMOKE_CHECK_COUNT, total: SMOKE_CHECK_COUNT })),
		readSchedules: vi.fn(() => liveSchedules()),
		...overrides,
	};
}

describe("runRemoteDoctor", () => {
	it("adds content-free read-only provider and smoke checks", () => {
		const runWrangler = remoteRunner();
		const report = runRemoteDoctor(remoteInputs({ runWrangler }));

		expect(report.mode).toBe("remote");
		expect(report.ready).toBe(true);
		expect(report.summary).toEqual({ pass: report.checks.length, fail: 0, warn: 0 });
		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "remote.cron", status: "pass", observed: 1 }),
			expect.objectContaining({ id: "remote.deployment", status: "pass", observed: 1 }),
			expect.objectContaining({ id: "remote.queues", status: "pass", observed: 5 }),
			expect.objectContaining({ id: "remote.secrets", status: "pass", observed: 1 }),
			expect.objectContaining({ id: "remote.smoke", status: "pass", observed: SMOKE_CHECK_COUNT }),
		]));
		expect(JSON.stringify(report)).not.toContain("zone-1");
		expect(JSON.stringify(report)).not.toContain("CF_TOKEN");
		expect(JSON.stringify(report)).not.toContain("account-id-must-not-appear");
		expect(runWrangler.mock.calls.flatMap(([args]) => args)).not.toContain("execute");
	});

	it("fails the smoke gate when the public contract is not completely proven", () => {
		for (const result of [
			{ passed: SMOKE_CHECK_COUNT - 1, total: SMOKE_CHECK_COUNT },
			{ passed: 6, total: 6 },
		]) {
			const report = runRemoteDoctor(remoteInputs({ runSmoke: vi.fn(() => result) }));
			expect(report.ready).toBe(false);
			expect(report.checks).toEqual(expect.arrayContaining([
				expect.objectContaining({ id: "remote.smoke", status: "fail" }),
			]));
		}
	});

	it("accepts a provider response that returns the schedule list directly", () => {
		const report = runRemoteDoctor(remoteInputs({
			readSchedules: vi.fn(() => ({ success: true, errors: [], result: [{ cron: "* * * * *" }] })),
		}));

		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "remote.cron", status: "pass", observed: 1 }),
		]));
	});

	it.each([
		["a count mismatch", liveSchedules(["* * * * *", "0 * * * *"]), "live schedule does not match configuration"],
		["an expression mismatch", liveSchedules(["*/5 * * * *"]), "live schedule does not match configuration"],
		["an empty live inventory", liveSchedules([]), "live schedule does not match configuration"],
		["a provider failure envelope", { success: false, errors: [{ code: 10000, message: "leaked-detail" }], result: null }, "provider rejected the schedule read"],
		["a reported error alongside success", { success: true, errors: [{ code: 10000 }], result: { schedules: [{ cron: "* * * * *" }] } }, "provider rejected the schedule read"],
		["a malformed response", "not-json-object", "schedule inventory was unreadable"],
		["non-string schedule entries", { success: true, errors: [], result: { schedules: [{ cron: 5 }] } }, "schedule inventory was unreadable"],
		["unavailable credentials", null, "no usable Wrangler session or API token for the schedule read"],
	])("fails the live Cron check for %s with a fixed reason", (_label, response, reason) => {
		const report = runRemoteDoctor(remoteInputs({ readSchedules: vi.fn(() => response) }));

		expect(report.ready).toBe(false);
		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "remote.cron",
				status: "fail",
				observed: 0,
				summary: `Live Cron schedule is not proven: ${reason}`,
			}),
		]));
		expect(JSON.stringify(report)).not.toContain("leaked-detail");
	});

	// A narrowly scoped credential fails the wrangler-backed checks together. The cron
	// reason must then name the unmet dependency instead of asserting something about
	// the deployed handler that this run never actually observed.
	it.each([
		["a version without the scheduled handler", {
			[`versions view ${versionId} --config wrangler.jsonc --json`]: JSON.stringify({
				id: versionId,
				resources: {
					script: { handlers: ["fetch", "email", "queue"] },
					script_runtime: { compatibility_date: "2026-07-22" },
					bindings: [],
				},
			}),
		}],
		["an unreadable deployment", {
			"deployments status --config wrangler.jsonc --json": new Error("unauthorized"),
		}],
	])("reports an unmet dependency for %s", (_label, overrides) => {
		const readSchedules = vi.fn(() => liveSchedules());
		const report = runRemoteDoctor(remoteInputs({
			runWrangler: remoteRunner(overrides), readSchedules,
		}));

		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "remote.cron",
				status: "fail",
				summary: "Live Cron schedule is not proven: the active Worker version could not be proven",
			}),
			expect.objectContaining({ id: "remote.version", status: "fail" }),
		]));
		expect(readSchedules).not.toHaveBeenCalled();
	});

	it("names a configuration schedule count that cannot be matched", () => {
		const twoSchedules = config();
		twoSchedules.triggers = { crons: ["* * * * *", "0 * * * *"] };
		const report = runRemoteDoctor(remoteInputs({ config: twoSchedules }));

		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "remote.cron",
				status: "fail",
				summary: "Live Cron schedule is not proven: configuration does not define exactly one schedule",
			}),
		]));
	});

	it("fails closed when the live schedule read throws", () => {
		const report = runRemoteDoctor(remoteInputs({
			readSchedules: vi.fn(() => { throw new Error("token leaked-detail"); }),
		}));

		expect(report.ready).toBe(false);
		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "remote.cron",
				status: "fail",
				summary: "Live Cron schedule is not proven: schedule inventory was unreadable",
			}),
		]));
		expect(JSON.stringify(report)).not.toContain("leaked-detail");
	});

	it("aggregates malformed, incomplete, missing-secret, and failed-smoke results safely", () => {
		const report = runRemoteDoctor(remoteInputs({
			runWrangler: remoteRunner({
				"deployments status --config wrangler.jsonc --json": "not-json token-value",
				"d1 migrations list DB --config wrangler.jsonc --remote": "0029_pending.sql",
				"queues list --config wrangler.jsonc --page 2": "another-page",
				"secret list --config wrangler.jsonc --format json": "[]",
				"email sending settings henriksen.dev": new Error("provider leaked-secret-value"),
			}),
			runSmoke: vi.fn(() => ({ passed: 5, total: SMOKE_CHECK_COUNT })),
		}));

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
		const readSchedules = vi.fn(() => liveSchedules());
		const report = runRemoteDoctor(remoteInputs({ origin, runWrangler, readSchedules }));
		expect(report.ready).toBe(false);
		expect(runWrangler).not.toHaveBeenCalled();
		expect(readSchedules).not.toHaveBeenCalled();
	});

	it("refuses an absent live schedule reader before provider access", () => {
		const runWrangler = remoteRunner();
		const report = runRemoteDoctor(remoteInputs({ runWrangler, readSchedules: undefined }));
		expect(report.ready).toBe(false);
		expect(report.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "remote.input", status: "fail" }),
		]));
		expect(runWrangler).not.toHaveBeenCalled();
	});
});
