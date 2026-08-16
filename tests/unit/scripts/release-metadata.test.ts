import { describe, expect, it, vi } from "vitest";

import { deriveReleaseMetadata, ReleaseMetadataError } from "../../../scripts/release-metadata.mjs";

function input(overrides: Record<string, unknown> = {}) {
	return {
		runGit: vi.fn((args: string[]) => args[0] === "status" ? "" : "a".repeat(40)),
		packageManifest: { name: "email-platform", version: "0.1.0", engines: { node: "^22.18.0 || >=24.11.0" } },
		packageLock: {
			lockfileVersion: 3,
			packages: {
				"": { name: "email-platform", version: "0.1.0" },
				"node_modules/next": { version: "16.3.0" },
				"node_modules/@opennextjs/cloudflare": { version: "1.20.2" },
				"node_modules/wrangler": { version: "4.114.0" },
			},
		},
		nodeVersion: "22.18.0",
		migrationNames: Array.from({ length: 29 }, (_, index) => `${String(index).padStart(4, "0")}_migration.sql`),
		schemaPolicy: { format: "lumimail-release-schema-v1", minimum: "0028", maximum: "0028" },
		sourceDateEpoch: "1786557600",
		notes: ["Deterministic release metadata."],
		...overrides,
	};
}

describe("deriveReleaseMetadata", () => {
	it("derives exact immutable metadata from a clean checkout and lockfile", () => {
		const source = input();
		const original = structuredClone({ ...source, runGit: undefined });
		const metadata = deriveReleaseMetadata(source);
		expect(metadata).toEqual({
			version: "0.1.0",
			builtAt: "2026-08-12T18:00:00.000Z",
			commit: "a".repeat(40),
			schema: { minimum: "0028", current: "0028", maximum: "0028" },
			runtime: { node: "22.18.0", next: "16.3.0", openNext: "1.20.2", wrangler: "4.114.0" },
			notes: ["Deterministic release metadata."],
		});
		expect(source.runGit).toHaveBeenNthCalledWith(1, ["status", "--porcelain=v1"]);
		expect(source.runGit).toHaveBeenNthCalledWith(2, ["rev-parse", "HEAD"]);
		expect({ ...source, runGit: undefined }).toEqual(original);
		expect(Object.isFrozen(metadata)).toBe(true);
		expect(Object.isFrozen(metadata.runtime)).toBe(true);
	});

	it.each([
		["dirty tree", { runGit: vi.fn((args: string[]) => args[0] === "status" ? " M file" : "a".repeat(40)) }],
		["short commit", { runGit: vi.fn((args: string[]) => args[0] === "status" ? "" : "abc123") }],
		["bad epoch", { sourceDateEpoch: "now" }],
		["bad Node", { nodeVersion: "22.17.9" }],
		["unsupported Node major", { nodeVersion: "23.0.0" }],
		["early Node 24", { nodeVersion: "24.10.9" }],
		["malformed Node", { nodeVersion: "22" }],
		["package mismatch", { packageManifest: { name: "email-platform", version: "0.2.0", engines: { node: "^22.18.0 || >=24.11.0" } } }],
		["missing locked tool", { packageLock: { lockfileVersion: 3, packages: { "": { name: "email-platform", version: "0.1.0" } } } }],
		["migration gap", { migrationNames: ["0000_a.sql", "0002_b.sql"] }],
		["policy drift", { schemaPolicy: { format: "lumimail-release-schema-v1", minimum: "0027", maximum: "0027" } }],
		["unknown policy", { schemaPolicy: { format: "lumimail-release-schema-v1", minimum: "0028", maximum: "0028", extra: true } }],
		["bad notes", { notes: ["line one\nline two"] }],
	])("refuses %s", (_label, override) => {
		expect(() => deriveReleaseMetadata(input(override))).toThrow(ReleaseMetadataError);
	});

	it.each([
		["v22.18.0", "22.18.0"],
		["22.18.1", "22.18.1"],
		["24.11.0", "24.11.0"],
		["25.0.0", "25.0.0"],
	])("accepts supported Node runtime %s", (nodeVersion, normalized) => {
		expect(deriveReleaseMetadata(input({ nodeVersion })).runtime.node).toBe(normalized);
	});
});
