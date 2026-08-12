import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeRecoveryManifest } from "../../../scripts/recovery-manifest.mjs";
import { restoreRecovery } from "../../../scripts/recovery-restore.mjs";

const temporary: string[] = [];

afterEach(() => {
	for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
	temporary.length = 0;
});

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function backupDirectory(options?: { corrupt?: boolean }): string {
	const directory = mkdtempSync(join(tmpdir(), "lumimail-remote-restore-"));
	temporary.push(directory);
	const database = "database export";
	const object = "object bytes";
	writeFileSync(join(directory, "d1.sql"), options?.corrupt ? `${database}!` : database);
	const objectPath = join(directory, "attachments", "u1", "m1", "a1");
	mkdirSync(dirname(objectPath), { recursive: true });
	writeFileSync(objectPath, object);
	writeFileSync(
		join(directory, "manifest.json"),
		canonicalizeRecoveryManifest({
			format: "lumimail-recovery-v1",
			product: "lumimail",
			createdAt: "2026-08-12T13:44:35.174Z",
			source: {
				accountId: "caddde404ba5d0324c315dc5cf143696",
				worker: {
					name: "lumimail",
					versionId: "721ad103-ec5a-4b0d-a48c-f664d6814451",
					scriptEtag: "a".repeat(64),
					compatibilityDate: "2026-07-22",
				},
				d1: {
					id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42",
					name: "lumimail-prod",
					bookmark: "bookmark",
				},
				r2: { bucketName: "lumimail-raw-prod" },
			},
			application: {
				gitCommit: "f4c48dbb71b0be27a0cbbdaffb4f639780858f7c",
				schemaVersion: "0028",
			},
			database: { path: "d1.sql", size: database.length, sha256: hash(database) },
			objects: [
				{
					key: "attachments/u1/m1/a1",
					size: object.length,
					etag: null,
					sha256: hash(object),
				},
			],
		}),
	);
	return directory;
}

const target = {
	accountId: "caddde404ba5d0324c315dc5cf143696",
	workerName: "lumimail-recovery-20260812",
	configPath: "wrangler.recovery.jsonc",
	d1: {
		binding: "DB",
		id: "d239de97-37f1-4b9a-a664-f787ea60aa97",
		name: "lumimail-staging",
	},
	r2: { bucketName: "lumimail-raw-staging" },
};

function runner(options?: { userTables?: number; objects?: number; routeOutput?: string }) {
	return vi.fn((args: string[]) => {
		if (args[0] === "d1" && args[1] === "execute" && args.includes("--command")) {
			return JSON.stringify([
				{ results: [{ userTableCount: options?.userTables ?? 0 }], success: true },
			]);
		}
		if (args[0] === "r2" && args[1] === "bucket") {
			return JSON.stringify({ object_count: String(options?.objects ?? 0) });
		}
		if (args[0] === "email" && args[2] === "list") {
			return "│ henriksen.dev │ zone-1 │ yes │";
		}
		if (args[0] === "email" && args[2] === "rules") {
			return options?.routeOutput ?? "Actions: worker:lumimail";
		}
		if (args[0] === "d1" && args[1] === "execute" && args.includes("--file")) {
			return "";
		}
		if (args[0] === "r2" && args[1] === "object" && args[2] === "put") {
			return "";
		}
		throw new Error(`unexpected command: ${args.join(" ")}`);
	});
}

describe("restoreRecovery", () => {
	it("guards fresh remote resources and restores only the declared D1/R2 data", () => {
		const runWrangler = runner();
		const result = restoreRecovery({
			backupDirectory: backupDirectory(),
			target,
			runWrangler,
		});

		expect(result).toEqual({ restoredDatabase: 1, restoredObjects: 1 });
		const commands = runWrangler.mock.calls.map(([args]) => args.join(" "));
		expect(commands.at(-2)).toMatch(
			/^d1 execute DB --config wrangler\.recovery\.jsonc --remote --file /,
		);
		expect(commands.at(-1)).toMatch(
			/^r2 object put lumimail-raw-staging\/attachments\/u1\/m1\/a1 --remote --file /,
		);
		expect(commands.join(" ")).not.toMatch(/\b(?:delete|deploy|routing rules create)\b/);
	});

	it("rejects corrupt local evidence before provider access", () => {
		const runWrangler = runner();
		expect(() =>
			restoreRecovery({
				backupDirectory: backupDirectory({ corrupt: true }),
				target,
				runWrangler,
			}),
		).toThrow("Recovery backup failed offline verification");
		expect(runWrangler).not.toHaveBeenCalled();
	});

	it("rejects populated target stores before writes", () => {
		const runWrangler = runner({ userTables: 1, objects: 2 });
		expect(() =>
			restoreRecovery({ backupDirectory: backupDirectory(), target, runWrangler }),
		).toThrow("Recovery target is unsafe");
		expect(runWrangler.mock.calls.some(([args]) => args.includes("--file"))).toBe(false);
	});

	it("rejects any observed route to the recovery Worker before writes", () => {
		const runWrangler = runner({
			routeOutput: "Enabled: true\nActions: worker:lumimail-recovery-20260812",
		});
		expect(() =>
			restoreRecovery({ backupDirectory: backupDirectory(), target, runWrangler }),
		).toThrow("Recovery target is unsafe");
		expect(runWrangler.mock.calls.some(([args]) => args.includes("--file"))).toBe(false);
	});
});
