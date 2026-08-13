import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeRecoveryManifest } from "../../../scripts/recovery-manifest.mjs";
import { setRecoveryRetention } from "../../../scripts/recovery-retention.mjs";

const temporary: string[] = [];

afterEach(() => {
	for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
	temporary.length = 0;
});

function evidence(bytes: string) {
	return { size: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") };
}

function archive() {
	const directory = mkdtempSync(join(tmpdir(), "lumimail-retention-test-"));
	temporary.push(directory);
	const database = "INSERT INTO x VALUES('attachments/u1/m1/a1');";
	const object = "attachment";
	writeFileSync(join(directory, "d1.sql"), database);
	const objectPath = join(directory, "attachments", "u1", "m1", "a1");
	mkdirSync(dirname(objectPath), { recursive: true });
	writeFileSync(objectPath, object);
	writeFileSync(join(directory, "manifest.json"), canonicalizeRecoveryManifest({
		format: "lumimail-recovery-v1",
		product: "lumimail",
		createdAt: "2026-08-13T20:00:00.000Z",
		source: {
			accountId: "caddde404ba5d0324c315dc5cf143696",
			worker: { name: "lumimail", versionId: "721ad103-ec5a-4b0d-a48c-f664d6814451",
				scriptEtag: "5bd0e61aed0aa76c3173ab81b708572df8a6362879965d37887e4f77209947c6",
				compatibilityDate: "2026-07-22" },
			d1: { id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42", name: "lumimail-prod", bookmark: null },
			r2: { bucketName: "lumimail-raw-prod" },
		},
		application: { gitCommit: "f4c48dbb71b0be27a0cbbdaffb4f639780858f7c", schemaVersion: "0028" },
		database: { path: "d1.sql", ...evidence(database) },
		objects: [{ key: "attachments/u1/m1/a1", ...evidence(object), etag: null }],
	}));
	return directory;
}

function readPolicy(directory: string) {
	return JSON.parse(readFileSync(join(directory, "retention-policy.json"), "utf8"));
}

describe("setRecoveryRetention", () => {
	it("prepares a content-free pending policy after archive verification", () => {
		const directory = archive();
		expect(setRecoveryRetention({ archiveDirectory: directory, days: 30,
			now: () => new Date("2026-08-13T21:00:00.000Z") })).toEqual({
			cleanupCompletedAt: null,
			destroyAfter: null,
			format: "lumimail-recovery-retention-v1",
			retentionDays: 30,
			updatedAt: "2026-08-13T21:00:00.000Z",
		});
		expect(readPolicy(directory)).toEqual(expect.objectContaining({ retentionDays: 30 }));
		expect(JSON.stringify(readPolicy(directory))).not.toMatch(/lumimail-prod|attachments|private|test-/i);
	});

	it("records cleanup once and recomputes destruction when days change", () => {
		const directory = archive();
		setRecoveryRetention({ archiveDirectory: directory, days: 30, cleanupCompletedNow: true,
			now: () => new Date("2026-08-13T22:00:00.000Z") });
		expect(readPolicy(directory)).toEqual({
			cleanupCompletedAt: "2026-08-13T22:00:00.000Z",
			destroyAfter: "2026-09-12T22:00:00.000Z",
			format: "lumimail-recovery-retention-v1",
			retentionDays: 30,
			updatedAt: "2026-08-13T22:00:00.000Z",
		});
		setRecoveryRetention({ archiveDirectory: directory, days: 45, cleanupCompletedNow: true,
			now: () => new Date("2026-08-14T01:00:00.000Z") });
		expect(readPolicy(directory)).toEqual(expect.objectContaining({
			cleanupCompletedAt: "2026-08-13T22:00:00.000Z",
			destroyAfter: "2026-09-27T22:00:00.000Z",
			retentionDays: 45,
		}));
	});

	it.each([0, 3651, 1.5, Number.NaN])("refuses invalid retention days %s", (days) => {
		const directory = archive();
		expect(() => setRecoveryRetention({ archiveDirectory: directory, days })).toThrow("1 through 3650");
		expect(readdirSync(directory)).not.toContain("retention-policy.json");
	});

	it("refuses invalid archive bytes and malformed existing policy", () => {
		const invalidArchive = archive();
		writeFileSync(join(invalidArchive, "d1.sql"), "changed");
		expect(() => setRecoveryRetention({ archiveDirectory: invalidArchive, days: 30 })).toThrow("integrity");
		const invalidPolicy = archive();
		writeFileSync(join(invalidPolicy, "retention-policy.json"), JSON.stringify({ retentionDays: 30, private: "data" }));
		expect(() => setRecoveryRetention({ archiveDirectory: invalidPolicy, days: 30 })).toThrow("existing policy");
	});

	it("preserves the previous policy and removes its partial file when atomic replacement fails", () => {
		const directory = archive();
		setRecoveryRetention({ archiveDirectory: directory, days: 30,
			now: () => new Date("2026-08-13T21:00:00.000Z") });
		const before = readFileSync(join(directory, "retention-policy.json"), "utf8");
		expect(() => setRecoveryRetention({ archiveDirectory: directory, days: 60,
			now: () => new Date("2026-08-13T22:00:00.000Z"), renameFile: vi.fn(() => { throw new Error("PRIVATE"); }) }))
			.toThrow("could not be updated");
		expect(readFileSync(join(directory, "retention-policy.json"), "utf8")).toBe(before);
		expect(readdirSync(directory).filter((name) => name.includes("retention-policy.partial"))).toEqual([]);
	});
});
