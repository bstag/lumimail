import { describe, expect, it, vi } from "vitest";

import { promoteVerifiedRelease, ReleasePromotionError } from "../../../scripts/release-promote.mjs";

const commit = "a".repeat(40);
const versionId = "34571aef-6642-4ea5-bc42-85eebb730e16";
const previewUrl = "https://34571aef-lumimail.bstag.workers.dev";

// Matches the labelled lines `wrangler versions upload` prints; it has no JSON mode.
function uploadOutput(overrides: { id?: string; url?: string; extra?: string } = {}) {
	return [
		"Total Upload: 1234.56 KiB / gzip: 234.56 KiB",
		"Uploaded lumimail (7.89 sec)",
		`Worker Version ID: ${overrides.id ?? versionId}`,
		`Version Preview URL: ${overrides.url ?? previewUrl}`,
		overrides.extra ?? "",
	].join("\n");
}

function inputs(overrides: Record<string, unknown> = {}) {
	return {
		bundleDirectory: "bundle",
		signaturePath: "signature.json",
		trustPath: "release.trust.json",
		sourceDirectory: ".open-next",
		expectedVersion: "1.2.3",
		expectedSchema: "0032",
		verifyRelease: vi.fn(() => ({
			version: "1.2.3", commit, schemaVersion: "0032", keyId: "bstag-2026",
			artifactSize: 2048, artifactSha256: "b".repeat(64),
		})),
		readCheckout: vi.fn(() => ({ commit, clean: true })),
		archiveSource: vi.fn(() => ({ size: 2048, sha256: "b".repeat(64) })),
		runWrangler: vi.fn((args: string[]) => (
			args[0] === "versions" && args[1] === "upload" ? uploadOutput() : ""
		)),
		runSmoke: vi.fn(() => ({ passed: 8, total: 8 })),
		...overrides,
	};
}

describe("promoteVerifiedRelease", () => {
	it("verifies, binds the checkout and artifact, uploads, smokes, then promotes in order", () => {
		const args = inputs();

		const report = promoteVerifiedRelease(args);

		expect(report).toEqual({
			version: "1.2.3", schemaVersion: "0032", keyId: "bstag-2026",
			commit, versionId, artifactSize: 2048, smokePassed: 8, promoted: true,
		});
		const commands = (args.runWrangler as ReturnType<typeof vi.fn>).mock.calls.map(([value]) => value);
		expect(commands[0].slice(0, 2)).toEqual(["versions", "upload"]);
		expect(commands[1].slice(0, 2)).toEqual(["versions", "deploy"]);
		expect(commands[1]).toContain(versionId);
		expect(commands[1]).toContain("--percentage");
		expect(commands[1]).toContain("100");
		// Smoke must run against the uploaded version, between upload and promotion.
		expect(args.runSmoke).toHaveBeenCalledWith(previewUrl);
	});

	it("refuses an unverified signature before touching the provider", () => {
		const args = inputs({
			verifyRelease: vi.fn(() => { throw new Error("PRIVATE trust detail"); }),
		});

		expect(() => promoteVerifiedRelease(args)).toThrow(ReleasePromotionError);
		expect(args.readCheckout).not.toHaveBeenCalled();
		expect(args.runWrangler).not.toHaveBeenCalled();
	});

	it.each([
		["a dirty checkout", { readCheckout: vi.fn(() => ({ commit, clean: false })) }],
		["a checkout at another commit", { readCheckout: vi.fn(() => ({ commit: "c".repeat(40), clean: true })) }],
	])("refuses %s so the signature cannot cover a different tree", (_label, override) => {
		const args = inputs(override);

		expect(() => promoteVerifiedRelease(args)).toThrow(ReleasePromotionError);
		expect(args.archiveSource).not.toHaveBeenCalled();
		expect(args.runWrangler).not.toHaveBeenCalled();
	});

	it.each([
		["a changed digest", { archiveSource: vi.fn(() => ({ size: 2048, sha256: "c".repeat(64) })) }],
		["a changed size", { archiveSource: vi.fn(() => ({ size: 4096, sha256: "b".repeat(64) })) }],
	])("refuses %s so an unsigned build cannot be promoted", (_label, override) => {
		const args = inputs(override);

		expect(() => promoteVerifiedRelease(args)).toThrow(ReleasePromotionError);
		expect(args.runWrangler).not.toHaveBeenCalled();
	});

	it.each([
		["unlabelled upload output", { runWrangler: vi.fn(() => "Uploaded lumimail (1.00 sec)") }],
		["an upload without a version id", { runWrangler: vi.fn(() => `Version Preview URL: ${previewUrl}`) }],
		["an upload without a preview origin", { runWrangler: vi.fn(() => `Worker Version ID: ${versionId}`) }],
		["a non-UUID version id", { runWrangler: vi.fn(() => uploadOutput({ id: "latest" })) }],
		["a non-HTTPS preview origin", { runWrangler: vi.fn(() => uploadOutput({ url: "http://preview.example.com" })) }],
		["two reported versions", { runWrangler: vi.fn(() => uploadOutput({ extra: `Worker Version ID: ${versionId}` })) }],
	])("leaves traffic unchanged for %s", (_label, override) => {
		const args = inputs(override);

		expect(() => promoteVerifiedRelease(args)).toThrow(ReleasePromotionError);
		const commands = (args.runWrangler as ReturnType<typeof vi.fn>).mock.calls.map(([value]) => value);
		expect(commands.some((command: string[]) => command[1] === "deploy")).toBe(false);
	});

	it("leaves an uploaded version unpromoted when its smoke does not fully pass", () => {
		const args = inputs({ runSmoke: vi.fn(() => ({ passed: 7, total: 8 })) });

		expect(() => promoteVerifiedRelease(args)).toThrow(ReleasePromotionError);
		const commands = (args.runWrangler as ReturnType<typeof vi.fn>).mock.calls.map(([value]) => value);
		expect(commands.some((command: string[]) => command[1] === "upload")).toBe(true);
		expect(commands.some((command: string[]) => command[1] === "deploy")).toBe(false);
	});

	it("refuses a verification report without the fields the digest binding compares", () => {
		const args = inputs({
			verifyRelease: vi.fn(() => ({ version: "1.2.3", commit, schemaVersion: "0032", keyId: "bstag-2026" })),
		});

		expect(() => promoteVerifiedRelease(args)).toThrow(ReleasePromotionError);
		expect(args.runWrangler).not.toHaveBeenCalled();
	});

	it("never runs a migration, deployment, or data command", () => {
		const args = inputs();

		promoteVerifiedRelease(args);

		const flat = (args.runWrangler as ReturnType<typeof vi.fn>).mock.calls.flatMap(([value]) => value);
		for (const forbidden of ["d1", "migrations", "execute", "deploy --", "r2", "secret", "delete"]) {
			expect(flat).not.toContain(forbidden);
		}
	});
});
