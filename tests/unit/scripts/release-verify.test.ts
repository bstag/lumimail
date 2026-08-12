import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeReleaseManifest, createReleaseManifest, signReleaseManifest } from "../../../scripts/release-manifest.mjs";
import { ReleaseTrustError, runReleaseVerificationCommand, verifyPreparedRelease } from "../../../scripts/release-verify.mjs";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "lumimail-release-verify-"));
	temporary.push(root);
	const bundle = join(root, "bundle"); mkdirSync(bundle);
	const artifact = Buffer.from("worker archive");
	const manifest = createReleaseManifest({
		version: "1.2.3", builtAt: "2026-08-12T18:00:00.000Z", commit: "a".repeat(40),
		artifactPath: "lumimail-worker.tar.gz", artifactBytes: artifact,
		schema: { minimum: "0027", current: "0028", maximum: "0029" },
		runtime: { node: "22.16.0", next: "16.3.0", openNext: "1.20.2", wrangler: "4.114.0" },
		notes: ["Private note"],
	});
	writeFileSync(join(bundle, "manifest.json"), canonicalizeReleaseManifest(manifest));
	writeFileSync(join(bundle, "lumimail-worker.tar.gz"), artifact);
	const keys = generateKeyPairSync("ed25519");
	const signaturePath = join(root, "signature.json");
	writeFileSync(signaturePath, JSON.stringify(signReleaseManifest(manifest, keys.privateKey, "release-2026")));
	const trustPath = join(root, "trust.json");
	writeFileSync(trustPath, JSON.stringify({ format: "lumimail-release-trust-v1", keys: {
		"release-2026": keys.publicKey.export({ type: "spki", format: "pem" }),
	} }));
	return { root, bundle, artifact, signaturePath, trustPath };
}

describe("pinned release verification", () => {
	it("verifies the exact trusted signer, identity, schema, and artifact", () => {
		const value = fixture();
		expect(verifyPreparedRelease({ bundleDirectory: value.bundle, signaturePath: value.signaturePath,
			trustPath: value.trustPath, expectedVersion: "1.2.3", expectedSchema: "0028",
		})).toMatchObject({ verified: true, keyId: "release-2026", version: "1.2.3", schemaVersion: "0028" });
	});

	it("rejects substitution and mismatched version or schema", () => {
		for (const mode of ["artifact", "version", "schema"]) {
			const value = fixture();
			if (mode === "artifact") writeFileSync(join(value.bundle, "lumimail-worker.tar.gz"), "changed");
			expect(() => verifyPreparedRelease({ bundleDirectory: value.bundle, signaturePath: value.signaturePath,
				trustPath: value.trustPath, expectedVersion: mode === "version" ? "1.2.4" : "1.2.3",
				expectedSchema: mode === "schema" ? "0030" : "0028",
			})).toThrow(ReleaseTrustError);
		}
	});

	it("rejects unknown trust fields, unknown signers, and non-Ed25519 keys", () => {
		for (const mode of ["field", "unknown", "wrong-key"]) {
			const value = fixture();
			const trust = JSON.parse(readFileSync(value.trustPath, "utf8"));
			if (mode === "field") trust.extra = true;
			if (mode === "unknown") trust.keys = {};
			if (mode === "wrong-key") trust.keys["release-2026"] = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" });
			writeFileSync(value.trustPath, JSON.stringify(trust));
			expect(() => verifyPreparedRelease({ bundleDirectory: value.bundle, signaturePath: value.signaturePath,
				trustPath: value.trustPath, expectedVersion: "1.2.3", expectedSchema: "0028",
			})).toThrow(ReleaseTrustError);
		}
	});

	it("prints a bounded success report without private content", () => {
		const value = fixture(); const stdout = vi.fn(); const stderr = vi.fn();
		expect(runReleaseVerificationCommand([value.bundle, value.signaturePath, value.trustPath, "1.2.3", "0028"], { stdout, stderr })).toBe(0);
		expect(stderr).not.toHaveBeenCalled(); expect(stdout.mock.calls[0][0]).toContain("release-2026");
		expect(stdout.mock.calls[0][0]).not.toContain("Private note");
	});

	it("collapses arguments and caught errors into one content-free failure", () => {
		const stderr = vi.fn();
		expect(runReleaseVerificationCommand(["short"], { stdout: vi.fn(), stderr,
			verifyRelease: () => { throw new Error("PRIVATE KEY TEXT"); },
		})).toBe(1);
		expect(stderr).toHaveBeenCalledWith("Release verification failed. Release is not trusted.");
		expect(stderr.mock.calls[0][0]).not.toContain("PRIVATE KEY TEXT");
	});
});
