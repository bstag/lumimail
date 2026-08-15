import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeReleaseManifest, createReleaseManifest, verifySignedRelease } from "../../../scripts/release-manifest.mjs";
import { ReleaseSigningError, runReleaseSigningCommand, signPreparedRelease } from "../../../scripts/release-sign.mjs";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "lumimail-release-sign-"));
	temporary.push(root);
	const bundle = join(root, "bundle");
	mkdirSync(bundle);
	const artifact = Buffer.from("worker archive");
	writeFileSync(join(bundle, "lumimail-worker.tar.gz"), artifact);
	const manifest = createReleaseManifest({
		version: "1.2.3", builtAt: "2026-08-12T18:00:00.000Z", commit: "a".repeat(40),
		artifactPath: "lumimail-worker.tar.gz", artifactBytes: artifact,
		schema: { minimum: "0028", current: "0028", maximum: "0028" },
		runtime: { node: "22.16.0", next: "16.3.0", openNext: "1.20.2", wrangler: "4.114.0" },
		notes: ["Private note"],
	});
	writeFileSync(join(bundle, "manifest.json"), canonicalizeReleaseManifest(manifest));
	const keys = generateKeyPairSync("ed25519");
	const privatePem = Buffer.from(keys.privateKey.export({ type: "pkcs8", format: "pem" }));
	return { root, bundle, artifact, manifest, privatePem, ...keys };
}

describe("offline release signing", () => {
	it("writes a detached signature that verifies against the exact bundle", () => {
		const value = fixture();
		const signaturePath = join(value.root, "manifest.sig.json");
		const report = signPreparedRelease({ bundleDirectory: value.bundle, keyId: "release-2026", privateKeyInput: value.privateKey, signaturePath });
		const signature = readFileSync(signaturePath, "utf8");
		expect(report).toMatchObject({ keyId: "release-2026", version: "1.2.3" });
		expect(verifySignedRelease({ manifest: value.manifest, signature, artifactBytes: value.artifact,
			trustedPublicKeys: { "release-2026": value.publicKey },
			expected: { product: "lumimail", version: "1.2.3", schemaVersion: "0028" },
		}).verified).toBe(true);
	});

	it("refuses substituted artifacts, existing output, and output inside the bundle", () => {
		for (const mode of ["substitute", "existing", "inside"]) {
			const value = fixture();
			const output = mode === "inside" ? join(value.bundle, "signature.json") : join(value.root, "signature.json");
			if (mode === "substitute") writeFileSync(join(value.bundle, "lumimail-worker.tar.gz"), "changed");
			if (mode === "existing") writeFileSync(output, "keep");
			expect(() => signPreparedRelease({ bundleDirectory: value.bundle, keyId: "release-2026", privateKeyInput: value.privateKey, signaturePath: output })).toThrow(ReleaseSigningError);
			if (mode === "existing") expect(readFileSync(output, "utf8")).toBe("keep");
			else expect(existsSync(output)).toBe(false);
		}
	});

	it("uses injected stdin and prints only a bounded report", () => {
		const value = fixture();
		const stdout = vi.fn(); const stderr = vi.fn();
		const code = runReleaseSigningCommand([value.bundle, "release-2026", join(value.root, "signature.json")], {
			readStdin: () => value.privatePem, stdout, stderr,
		});
		expect(code).toBe(0); expect(stderr).not.toHaveBeenCalled();
		expect(stdout.mock.calls[0][0]).toContain("release-2026");
		expect(stdout.mock.calls[0][0]).not.toContain("Private note");
	});

	it("collapses invalid arguments and private errors", () => {
		const stderr = vi.fn();
		expect(runReleaseSigningCommand(["only"], { stderr, stdout: vi.fn(), readStdin: () => { throw new Error("PRIVATE"); } })).toBe(1);
		expect(stderr).toHaveBeenCalledWith("Release signing failed. No signature was published.");
		expect(stderr.mock.calls[0][0]).not.toContain("PRIVATE");
	});
});
