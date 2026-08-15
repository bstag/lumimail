import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	RecoveryManifestError,
	canonicalizeRecoveryManifest,
	parseRecoveryManifest,
	verifyRecoveryDirectory,
} from "../../../scripts/recovery-manifest.mjs";

const temporary: string[] = [];

afterEach(() => {
	for (const directory of temporary) {
		rmSync(directory, { recursive: true, force: true });
	}
	temporary.length = 0;
});

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function manifestFixture() {
	return {
		format: "lumimail-recovery-v1",
		product: "lumimail",
		createdAt: "2026-08-12T13:00:00.000Z",
		source: {
			accountId: "CADDDE404BA5D0324C315DC5CF143696",
			worker: {
				name: "lumimail",
				versionId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
				scriptEtag: "B".repeat(64),
				compatibilityDate: "2026-07-22",
			},
			d1: {
				id: "FFE4DE32-CF15-4F56-96B5-E14DC8031B42",
				name: "lumimail-prod",
				bookmark: null,
			},
			r2: { bucketName: "lumimail-raw-prod" },
		},
		application: {
			gitCommit: "402FBA0B2B96737905885051669CF15B32C553EF",
			schemaVersion: "0028",
		},
		database: {
			path: "d1.sql",
			size: "database".length,
			sha256: sha256("database").toUpperCase(),
		},
		objects: [
			{
				key: "inbound/2.eml",
				size: "second".length,
				etag: null,
				sha256: sha256("second").toUpperCase(),
			},
			{
				key: "attachments/u1/m1/a1",
				size: "first".length,
				etag: "etag-1",
				sha256: sha256("first"),
			},
		],
	};
}

function problemsFor(value: unknown): readonly string[] {
	try {
		parseRecoveryManifest(value);
		throw new Error("expected manifest to be rejected");
	} catch (error) {
		expect(error).toBeInstanceOf(RecoveryManifestError);
		return (error as InstanceType<typeof RecoveryManifestError>).problems;
	}
}

function writeRecoveryDirectory() {
	const directory = mkdtempSync(join(tmpdir(), "lumimail-recovery-v1-"));
	temporary.push(directory);
	const manifest = manifestFixture();
	writeFileSync(join(directory, "d1.sql"), "database");
	for (const [entry, content] of [
		[manifest.objects[0], "second"],
		[manifest.objects[1], "first"],
	] as const) {
		const path = join(directory, ...entry.key.split("/"));
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	writeFileSync(join(directory, "manifest.json"), canonicalizeRecoveryManifest(manifest));
	return { directory, manifest };
}

describe("recovery manifest v1", () => {
	it("normalizes, sorts, and deeply freezes a complete manifest without mutating input", () => {
		const source = manifestFixture();
		const original = structuredClone(source);

		const parsed = parseRecoveryManifest(source);

		expect(source).toEqual(original);
		expect(parsed.source.accountId).toBe(source.source.accountId.toLowerCase());
		expect(parsed.source.worker.versionId).toBe(
			source.source.worker.versionId.toLowerCase(),
		);
		expect(parsed.source.worker.scriptEtag).toBe("b".repeat(64));
		expect(parsed.source.d1.id).toBe(source.source.d1.id.toLowerCase());
		expect(parsed.application.gitCommit).toBe(
			source.application.gitCommit.toLowerCase(),
		);
		expect(parsed.database.sha256).toBe(source.database.sha256.toLowerCase());
		expect(parsed.objects.map((entry: { key: string }) => entry.key)).toEqual([
			"attachments/u1/m1/a1",
			"inbound/2.eml",
		]);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.source.worker)).toBe(true);
		expect(Object.isFrozen(parsed.objects)).toBe(true);
		expect(Object.isFrozen(parsed.objects[0])).toBe(true);
	});

	it("parses JSON and emits stable canonical bytes", () => {
		const source = manifestFixture();
		const first = canonicalizeRecoveryManifest(JSON.stringify(source, null, 2));
		const second = canonicalizeRecoveryManifest(parseRecoveryManifest(source));

		expect(first).toBe(second);
		expect(first.endsWith("\n")).toBe(true);
		expect(first.endsWith("\n\n")).toBe(false);
		expect(first).not.toContain("\n  ");
		expect(first.indexOf('"application"')).toBeLessThan(
			first.indexOf('"createdAt"'),
		);
	});

	it("rejects malformed JSON, legacy manifests, foreign products, and unknown fields", () => {
		expect(problemsFor("{")[0]).toBe("manifest must be valid JSON");
		expect(problemsFor({ objects: [] })).toContain(
			"format: must equal lumimail-recovery-v1",
		);

		const foreign = { ...manifestFixture(), product: "other-product" };
		expect(problemsFor(foreign)).toContain("product: must equal lumimail");

		const unknown = { ...manifestFixture(), token: "must-not-be-accepted" };
		expect(problemsFor(unknown)).toContain(
			"manifest: unknown fields are not allowed",
		);
	});

	it("rejects duplicate, traversal, and foreign R2 keys", () => {
		const duplicate = manifestFixture();
		duplicate.objects[1].key = duplicate.objects[0].key;
		expect(problemsFor(duplicate)).toContain(
			"objects: object keys must be unique",
		);

		for (const key of ["attachments/../secret", "other/object"] as const) {
			const unsafe = manifestFixture();
			unsafe.objects[0].key = key;
			expect(problemsFor(unsafe)).toContain(
				"objects.0.key: must be a safe Lumimail R2 key",
			);
		}
	});

	it("aggregates malformed source, application, database, and object metadata", () => {
		const invalid = manifestFixture();
		invalid.createdAt = "yesterday";
		invalid.source.accountId = "ACCOUNT_ID";
		invalid.source.worker.compatibilityDate = "soon";
		Object.assign(invalid.source.d1, { bookmark: "" });
		invalid.application.schemaVersion = "latest";
		invalid.database.path = "../d1.sql";
		invalid.database.size = -1;
		invalid.objects[0].etag = "";

		const problems = problemsFor(invalid);
		expect(problems).toEqual(
			expect.arrayContaining([
				"createdAt: must be an exact UTC ISO timestamp",
				"source.accountId: must be a Cloudflare account ID",
				"source.worker.compatibilityDate: must be YYYY-MM-DD",
				"source.d1.bookmark: must be non-empty or null",
				"application.schemaVersion: must be a four-digit migration prefix",
				"database.path: must equal d1.sql",
				"database.size: must be a non-negative integer",
				"objects.0.etag: must be non-empty or null",
			]),
		);
	});

	it("returns immutable structured validation errors", () => {
		try {
			parseRecoveryManifest({});
			throw new Error("expected manifest to be rejected");
		} catch (error) {
			expect(error).toBeInstanceOf(RecoveryManifestError);
			const manifestError = error as InstanceType<typeof RecoveryManifestError>;
			expect(manifestError.code).toBe("INVALID_RECOVERY_MANIFEST");
			expect(manifestError.message).toMatch(/^Recovery manifest is invalid \(/);
			expect(Object.isFrozen(manifestError.problems)).toBe(true);
			expect(() =>
				(manifestError.problems as string[]).push("caller mutation"),
			).toThrow();
		}
	});
});

describe("verifyRecoveryDirectory", () => {
	it("verifies the database and every exact R2 object offline", () => {
		const { directory } = writeRecoveryDirectory();

		expect(verifyRecoveryDirectory(directory)).toEqual({
			checkedDatabase: 1,
			checkedObjects: 2,
			problems: [],
		});
	});

	it("aggregates missing database and object files", () => {
		const { directory, manifest } = writeRecoveryDirectory();
		rmSync(join(directory, "d1.sql"));
		rmSync(join(directory, ...manifest.objects[0].key.split("/")));

		expect(verifyRecoveryDirectory(directory).problems).toEqual([
			"d1.sql: file missing from backup",
			"inbound/2.eml: file missing from backup",
		]);
	});

	it("reports both size and checksum changes", () => {
		const { directory } = writeRecoveryDirectory();
		writeFileSync(join(directory, "d1.sql"), "database-tampered");
		writeFileSync(
			join(directory, "attachments", "u1", "m1", "a1"),
			"first-tampered",
		);

		expect(verifyRecoveryDirectory(directory).problems).toEqual([
			"d1.sql: size 17 != 8",
			"d1.sql: checksum mismatch",
			"attachments/u1/m1/a1: size 14 != 5",
			"attachments/u1/m1/a1: checksum mismatch",
		]);
	});

	it("fails closed when manifest.json is missing", () => {
		const directory = mkdtempSync(join(tmpdir(), "lumimail-recovery-v1-"));
		temporary.push(directory);

		expect(() => verifyRecoveryDirectory(directory)).toThrowError(
			expect.objectContaining({
				code: "INVALID_RECOVERY_MANIFEST",
				problems: ["manifest.json: file missing from backup"],
			}),
		);
	});
});
