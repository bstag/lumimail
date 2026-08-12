import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	ReleaseManifestError,
	canonicalizeReleaseManifest,
	parseReleaseManifest,
	signReleaseManifest,
	verifySignedRelease,
} from "../../../scripts/release-manifest.mjs";

const artifact = Buffer.from("immutable-worker-archive");
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function manifestFixture() {
	return {
		format: "lumimail-release-v1",
		product: "lumimail",
		version: "0.1.0",
		builtAt: "2026-08-12T17:00:00.000Z",
		commit: "a".repeat(40),
		artifact: { path: "lumimail-worker-0.1.0.tar.gz", size: artifact.length, sha256: sha256(artifact).toUpperCase() },
		schema: { minimum: "0027", current: "0028", maximum: "0029" },
		runtime: { node: "22.16.0", next: "16.3.0", openNext: "1.20.2", wrangler: "4.114.0" },
		notes: ["Remote doctor and signed-release foundation.", "Recovery rollback proven."],
	};
}

describe("release manifest v1", () => {
	it("strictly normalizes, canonicalizes, sorts notes, freezes, and preserves input", () => {
		const source = manifestFixture();
		const original = structuredClone(source);
		const parsed = parseReleaseManifest(source);
		expect(source).toEqual(original);
		expect(parsed.artifact.sha256).toBe(source.artifact.sha256.toLowerCase());
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.artifact)).toBe(true);
		expect(canonicalizeReleaseManifest(source)).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
	});

	it.each([
		["wrong product", { product: "other" }],
		["unknown field", { extra: true }],
		["path traversal", { artifact: { ...manifestFixture().artifact, path: "../worker.tgz" } }],
		["absolute path", { artifact: { ...manifestFixture().artifact, path: "C:\\worker.tgz" } }],
		["bad semver", { version: "v1" }],
		["bad timestamp", { builtAt: "today" }],
		["schema inversion", { schema: { minimum: "0029", current: "0028", maximum: "0027" } }],
		["multiline note", { notes: ["line one\nline two"] }],
		["too many notes", { notes: Array.from({ length: 101 }, (_, index) => `note ${index}`) }],
	])("rejects %s", (_label, override) => {
		expect(() => parseReleaseManifest({ ...manifestFixture(), ...override })).toThrow(ReleaseManifestError);
	});

	it("signs canonical bytes and verifies identity, schema, artifact, and trusted key", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const manifest = manifestFixture();
		const signature = signReleaseManifest(manifest, privateKey, "release-2026-a");
		expect(signature).toMatchObject({
			format: "lumimail-release-signature-v1",
			algorithm: "Ed25519",
			keyId: "release-2026-a",
			manifestSha256: sha256(canonicalizeReleaseManifest(manifest)),
		});
		expect(verifySignedRelease({
			manifest,
			signature,
			artifactBytes: artifact,
			trustedPublicKeys: { "release-2026-a": publicKey },
			expected: { product: "lumimail", version: "0.1.0", schemaVersion: "0028" },
		})).toEqual({
			artifactSha256: sha256(artifact),
			artifactSize: artifact.length,
			commit: "a".repeat(40),
			keyId: "release-2026-a",
			schemaVersion: "0028",
			version: "0.1.0",
			verified: true,
		});
	});

	it.each([
		["unknown key", { trustedPublicKeys: {} }],
		["wrong artifact", { artifactBytes: Buffer.from("changed") }],
		["wrong version", { expected: { product: "lumimail", version: "0.2.0", schemaVersion: "0028" } }],
		["incompatible schema", { expected: { product: "lumimail", version: "0.1.0", schemaVersion: "0030" } }],
	])("rejects %s before release use", (_label, override) => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const manifest = manifestFixture();
		const signature = signReleaseManifest(manifest, privateKey, "key-a");
		expect(() => verifySignedRelease({
			manifest,
			signature,
			artifactBytes: artifact,
			trustedPublicKeys: { "key-a": publicKey },
			expected: { product: "lumimail", version: "0.1.0", schemaVersion: "0028" },
			...override,
		})).toThrow(/release verification failed/i);
	});

	it("rejects manifest or signature tampering", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		const manifest = manifestFixture();
		const signature = signReleaseManifest(manifest, privateKey, "key-a");
		const tampered = { ...manifest, notes: [...manifest.notes, "tampered"] };
		expect(() => verifySignedRelease({
			manifest: tampered,
			signature,
			artifactBytes: artifact,
			trustedPublicKeys: { "key-a": publicKey },
			expected: { product: "lumimail", version: "0.1.0", schemaVersion: "0028" },
		})).toThrow(/release verification failed/i);
	});
});
