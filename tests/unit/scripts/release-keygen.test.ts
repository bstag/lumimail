import { createPrivateKey, createPublicKey } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createReleaseSigningKey,
	ReleaseKeygenError,
	runReleaseKeygenCommand,
} from "../../../scripts/release-keygen.mjs";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function workspace() {
	const root = mkdtempSync(join(tmpdir(), "lumimail-release-keygen-"));
	temporary.push(root);
	const keys = join(root, "keys");
	mkdirSync(keys);
	return {
		root,
		privateKeyPath: join(keys, "release-signing.pem"),
		trustPath: join(root, "release.trust.json"),
	};
}

function trustStore(path: string) {
	return JSON.parse(readFileSync(path, "utf8"));
}

describe("createReleaseSigningKey", () => {
	it("writes an owner-only private key and publishes only the public key", () => {
		const { privateKeyPath, trustPath } = workspace();

		const report = createReleaseSigningKey({ keyId: "bstag-2026", privateKeyPath, trustPath });

		expect(report.keyId).toBe("bstag-2026");
		expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);

		const privatePem = readFileSync(privateKeyPath, "utf8");
		expect(createPrivateKey(privatePem).asymmetricKeyType).toBe("ed25519");
		if (process.platform !== "win32") {
			expect(statSync(privateKeyPath).mode & 0o777).toBe(0o600);
		}

		const store = trustStore(trustPath);
		expect(store.format).toBe("lumimail-release-trust-v1");
		expect(Object.keys(store.keys)).toEqual(["bstag-2026"]);
		expect(createPublicKey(store.keys["bstag-2026"]).asymmetricKeyType).toBe("ed25519");
		// The published half must not carry private material.
		expect(JSON.stringify(store)).not.toContain("PRIVATE KEY");
		expect(JSON.stringify(report)).not.toContain("PRIVATE KEY");
	});

	it("adds a rotation key while retaining prior public keys", () => {
		const { privateKeyPath, trustPath } = workspace();
		createReleaseSigningKey({ keyId: "bstag-2026", privateKeyPath, trustPath });

		createReleaseSigningKey({
			keyId: "bstag-2027",
			privateKeyPath: `${privateKeyPath}.next`,
			trustPath,
		});

		expect(Object.keys(trustStore(trustPath).keys).sort()).toEqual(["bstag-2026", "bstag-2027"]);
	});

	it("refuses to overwrite an existing private key and leaves the store unchanged", () => {
		const { privateKeyPath, trustPath } = workspace();
		createReleaseSigningKey({ keyId: "bstag-2026", privateKeyPath, trustPath });
		const before = readFileSync(trustPath, "utf8");
		const keyBefore = readFileSync(privateKeyPath, "utf8");

		expect(() => createReleaseSigningKey({ keyId: "bstag-2027", privateKeyPath, trustPath }))
			.toThrow(ReleaseKeygenError);

		expect(readFileSync(privateKeyPath, "utf8")).toBe(keyBefore);
		expect(readFileSync(trustPath, "utf8")).toBe(before);
	});

	it("refuses a duplicate key id without touching either file", () => {
		const { privateKeyPath, trustPath } = workspace();
		createReleaseSigningKey({ keyId: "bstag-2026", privateKeyPath, trustPath });
		const before = readFileSync(trustPath, "utf8");

		expect(() => createReleaseSigningKey({
			keyId: "bstag-2026", privateKeyPath: `${privateKeyPath}.next`, trustPath,
		})).toThrow(ReleaseKeygenError);

		expect(readFileSync(trustPath, "utf8")).toBe(before);
	});

	// A private key inside the working tree is one `git add -A` away from being committed.
	it("refuses to write a private key inside the repository", () => {
		const { trustPath } = workspace();

		expect(() => createReleaseSigningKey({
			keyId: "bstag-2026",
			privateKeyPath: join(process.cwd(), "release-signing.pem"),
			trustPath,
		})).toThrow(ReleaseKeygenError);
	});

	it.each([
		["an empty id", ""],
		["an uppercase id", "Bstag-2026"],
		["a path-like id", "keys/bstag"],
		["an id starting with punctuation", "-bstag"],
		["an over-long id", "a".repeat(65)],
	])("refuses %s before generating anything", (_label, keyId) => {
		const { privateKeyPath, trustPath } = workspace();

		expect(() => createReleaseSigningKey({ keyId, privateKeyPath, trustPath }))
			.toThrow(ReleaseKeygenError);
		expect(() => readFileSync(privateKeyPath, "utf8")).toThrow();
	});

	it.each([
		["a malformed store", "{ not json"],
		["a foreign format", JSON.stringify({ format: "other-trust-v1", keys: {} })],
		["unexpected members", JSON.stringify({ format: "lumimail-release-trust-v1", keys: {}, extra: 1 })],
		["a non-Ed25519 entry", JSON.stringify({
			format: "lumimail-release-trust-v1",
			keys: { existing: "-----BEGIN PUBLIC KEY-----\nnot-a-key\n-----END PUBLIC KEY-----\n" },
		})],
	])("refuses %s rather than replacing it", (_label, contents) => {
		const { privateKeyPath, trustPath } = workspace();
		writeFileSync(trustPath, contents);

		expect(() => createReleaseSigningKey({ keyId: "bstag-2026", privateKeyPath, trustPath }))
			.toThrow(ReleaseKeygenError);
		expect(readFileSync(trustPath, "utf8")).toBe(contents);
	});

	it("refuses a store already at the pinned key bound", () => {
		const { privateKeyPath, trustPath } = workspace();
		const seed = workspace();
		createReleaseSigningKey({ keyId: "seed", privateKeyPath: seed.privateKeyPath, trustPath: seed.trustPath });
		const pem = trustStore(seed.trustPath).keys.seed;
		const keys = Object.fromEntries(Array.from({ length: 32 }, (_value, index) => [`key-${index}`, pem]));
		writeFileSync(trustPath, JSON.stringify({ format: "lumimail-release-trust-v1", keys }));

		expect(() => createReleaseSigningKey({ keyId: "bstag-2026", privateKeyPath, trustPath }))
			.toThrow(ReleaseKeygenError);
	});
});

describe("runReleaseKeygenCommand", () => {
	it("reports the key id and fingerprint without private material", () => {
		const { privateKeyPath, trustPath } = workspace();
		const stdout = vi.fn();

		expect(runReleaseKeygenCommand(["bstag-2026", privateKeyPath, trustPath], { stdout, stderr: vi.fn() }))
			.toBe(0);

		expect(JSON.stringify(stdout.mock.calls)).toContain("bstag-2026");
		expect(JSON.stringify(stdout.mock.calls)).not.toContain("PRIVATE KEY");
	});

	it.each([
		["too few arguments", ["bstag-2026"]],
		["an empty argument", ["bstag-2026", "", "trust.json"]],
		["extra arguments", ["bstag-2026", "a", "b", "c"]],
	])("refuses %s with one content-free message", (_label, args) => {
		const stderr = vi.fn();

		expect(runReleaseKeygenCommand(args, { stdout: vi.fn(), stderr })).toBe(1);
		expect(stderr).toHaveBeenCalledWith("Release key generation failed. No key was written.");
	});

	it("keeps a caught failure content-free", () => {
		const stderr = vi.fn();

		expect(runReleaseKeygenCommand(["bstag-2026", "/nonexistent/dir/key.pem", "/nonexistent/dir/trust.json"], {
			stdout: vi.fn(), stderr,
		})).toBe(1);
		expect(stderr).toHaveBeenCalledWith("Release key generation failed. No key was written.");
	});
});
