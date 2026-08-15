import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { recaptureRecovery } from "../../../scripts/recovery-recapture.mjs";
import { parseRecoveryManifest } from "../../../scripts/recovery-manifest.mjs";

const temporary: string[] = [];
const keys = Array.from({ length: 15 }, (_, index) =>
	index % 2 === 0 ? `attachments/u1/m1/a${index}` : `inbound/message-${index}.eml`);

afterEach(() => {
	for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
	temporary.length = 0;
});

function outputDirectory() {
	const parent = mkdtempSync(join(tmpdir(), "lumimail-recapture-test-"));
	temporary.push(parent);
	return join(parent, "backup");
}

function recoveryConfig() {
	return {
		name: "lumimail-recovery-20260812",
		account_id: "caddde404ba5d0324c315dc5cf143696",
		workers_dev: true,
		routes: [],
		vars: { PUBLIC_APP_URL: "https://lumimail-recovery-20260812.blackstag.workers.dev",
			R2_SWEEP_ENABLED: "false", SEED_ENABLED: "false" },
		d1_databases: [{ binding: "DB", database_name: "lumimail-staging",
			database_id: "d239de97-37f1-4b9a-a664-f787ea60aa97", migrations_dir: "drizzle/migrations" }],
		r2_buckets: [{ binding: "BUCKET", bucket_name: "lumimail-raw-staging" }],
	};
}

function runner(options?: {
	d1InventoryFails?: boolean;
	exportFails?: boolean;
	objectCount?: number;
	workerError?: Error & { stderr?: string };
	missingKey?: string;
}) {
	const workerError = options?.workerError ?? Object.assign(new Error("bounded"), {
		stderr: "Cloudflare API request failed [code: 10007]",
	});
	return vi.fn((args: string[]) => {
		if (args[0] === "deployments") throw workerError;
		if (args[0] === "d1" && args[1] === "list") {
			if (options?.d1InventoryFails) throw new Error("PRIVATE inventory response");
			return JSON.stringify([
				{ uuid: "d239de97-37f1-4b9a-a664-f787ea60aa97", name: "lumimail-staging" },
			]);
		}
		if (args[0] === "r2" && args[1] === "bucket" && args[2] === "info") {
			return JSON.stringify({ name: "lumimail-raw-staging", object_count: options?.objectCount ?? 15 });
		}
		if (args[0] === "email" && args[1] === "routing" && args[2] === "list") return "";
		if (args[0] === "d1" && args[1] === "export") {
			if (options?.exportFails) throw new Error("PRIVATE export response");
			writeFileSync(args[args.indexOf("--output") + 1],
				`INSERT INTO x VALUES(${keys.map((key) => `'${key}'`).join(",")});`);
			return "";
		}
		if (args[0] === "r2" && args[1] === "object" && args[2] === "get") {
			const key = args[3].slice("lumimail-raw-staging/".length);
			if (key === options?.missingKey) throw new Error("private provider failure");
			const path = args[args.indexOf("--file") + 1];
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, `bytes-${key}`);
			return "";
		}
		throw new Error(`unexpected command: ${args.join(" ")}`);
	});
}

function recapture(overrides: Record<string, unknown> = {}) {
	return recaptureRecovery({
		outputDirectory: outputDirectory(),
		gitClean: true,
		recoveryConfig: recoveryConfig(),
		now: () => new Date("2026-08-13T20:00:00.000Z"),
		runWrangler: runner(),
		...overrides,
	});
}

describe("recaptureRecovery", () => {
	it("recaptures the exact isolated resources read-only and emits known original provenance", () => {
		const output = outputDirectory();
		const runWrangler = runner();
		expect(recapture({ outputDirectory: output, runWrangler })).toEqual({
			checkedDatabase: 1,
			checkedObjects: 15,
			outputDirectory: output,
		});
		const manifest = parseRecoveryManifest(readFileSync(join(output, "manifest.json"), "utf8"));
		expect(manifest.source.worker).toEqual({
			compatibilityDate: "2026-07-22",
			name: "lumimail",
			scriptEtag: "5bd0e61aed0aa76c3173ab81b708572df8a6362879965d37887e4f77209947c6",
			versionId: "721ad103-ec5a-4b0d-a48c-f664d6814451",
		});
		expect(manifest.source.d1).toEqual({
			bookmark: null,
			id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42",
			name: "lumimail-prod",
		});
		expect(manifest.application).toEqual({
			gitCommit: "f4c48dbb71b0be27a0cbbdaffb4f639780858f7c",
			schemaVersion: "0028",
		});
		const commands = runWrangler.mock.calls.map(([args]) => args.join(" "));
		expect(commands.slice(0, 4)).toEqual([
			"deployments status --config wrangler.recovery.jsonc --json",
			"d1 list --config wrangler.recovery.jsonc --json",
			"r2 bucket info lumimail-raw-staging --config wrangler.recovery.jsonc --json",
			"email routing list",
		]);
		expect(commands.join(" ")).not.toMatch(/\b(?:put|delete|execute|restore|deploy)\b/);
	});

	it("refuses a dirty worktree or existing output before provider access", () => {
		const dirtyRunner = runner();
		expect(() => recapture({ gitClean: false, runWrangler: dirtyRunner })).toThrow("clean");
		expect(dirtyRunner).not.toHaveBeenCalled();
		const existing = outputDirectory();
		mkdirSync(existing);
		const existingRunner = runner();
		expect(() => recapture({ outputDirectory: existing, runWrangler: existingRunner })).toThrow("exists");
		expect(existingRunner).not.toHaveBeenCalled();
		const configRunner = runner();
		expect(() => recapture({ recoveryConfig: { ...recoveryConfig(), name: "lumimail" },
			runWrangler: configRunner })).toThrow("configuration");
		expect(configRunner).not.toHaveBeenCalled();
	});

	it("requires the exact Worker absence code before any data read", () => {
		const runWrangler = runner({ workerError: Object.assign(new Error("Worker not found"), { stderr: "PRIVATE" }) });
		expect(() => recapture({ runWrangler })).toThrow("absence");
		expect(runWrangler).toHaveBeenCalledTimes(1);
	});

	it("rejects bucket count drift before export", () => {
		const runWrangler = runner({ objectCount: 14 });
		expect(() => recapture({ runWrangler })).toThrow("15 objects");
		expect(runWrangler.mock.calls.some(([args]) => args[0] === "d1" && args[1] === "export")).toBe(false);
	});

	it("bounds provider inventory and export failures without retaining partial data", () => {
		for (const [options, expected] of [
			[{ d1InventoryFails: true }, "Recovery recapture D1 inventory could not be read"],
			[{ exportFails: true }, "Recovery recapture D1 export failed; partial recapture removed"],
		] as const) {
			const output = outputDirectory();
			let caught: unknown;
			try { recapture({ outputDirectory: output, runWrangler: runner(options) }); } catch (error) { caught = error; }
			expect(String(caught)).toContain(expected);
			expect(String(caught)).not.toContain("PRIVATE");
			expect(existsSync(output)).toBe(false);
		}
	});

	it("removes only its partial directory when a referenced object cannot be captured", () => {
		const output = outputDirectory();
		expect(() => recapture({ outputDirectory: output, runWrangler: runner({ missingKey: keys[4] }) }))
			.toThrow("partial recapture removed");
		expect(existsSync(output)).toBe(false);
		expect(readdirSync(dirname(output))).toEqual([]);
	});
});
