import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseReleaseManifest } from "../../../scripts/release-manifest.mjs";
import { prepareUnsignedReleaseBundle, ReleasePreparationError } from "../../../scripts/release-prepare.mjs";

const temporary: string[] = [];
afterEach(() => {
	for (const path of temporary) rmSync(path, { recursive: true, force: true });
	temporary.length = 0;
});

function metadata() {
	return {
		version: "0.1.0",
		builtAt: "2026-08-12T18:00:00.000Z",
		commit: "a".repeat(40),
		schema: { minimum: "0027", current: "0028", maximum: "0029" },
		runtime: { node: "22.16.0", next: "16.3.0", openNext: "1.20.2", wrangler: "4.114.0" },
		notes: ["Deterministic release bundle."],
	};
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "lumimail-release-prepare-"));
	temporary.push(root);
	const source = join(root, "source");
	mkdirSync(join(source, "assets"), { recursive: true });
	writeFileSync(join(source, "worker.js"), "worker");
	writeFileSync(join(source, "assets", "app.css"), "css");
	return { root, source, output: join(root, "release-0.1.0") };
}

describe("prepareUnsignedReleaseBundle", () => {
	it("atomically publishes exactly one archive and its byte-derived canonical manifest", () => {
		const { source, output } = fixture();
		const report = prepareUnsignedReleaseBundle({ sourceDirectory: source, outputDirectory: output, metadata: metadata() });
		expect(readdirSync(output).sort()).toEqual(["lumimail-worker.tar.gz", "manifest.json"]);
		const archive = readFileSync(join(output, "lumimail-worker.tar.gz"));
		const manifestBytes = readFileSync(join(output, "manifest.json"), "utf8");
		const manifest = parseReleaseManifest(manifestBytes);
		expect(manifest.artifact).toEqual({
			path: "lumimail-worker.tar.gz",
			size: archive.length,
			sha256: createHash("sha256").update(archive).digest("hex"),
		});
		expect(manifestBytes.endsWith("\n")).toBe(true);
		expect(report).toEqual({
			archiveSize: archive.length,
			entryCount: 3,
			outputDirectory: output,
			version: "0.1.0",
		});
		expect(Object.isFrozen(report)).toBe(true);
	});

	it("refuses an existing output and preserves its contents", () => {
		const { source, output } = fixture();
		mkdirSync(output);
		writeFileSync(join(output, "keep.txt"), "keep");
		expect(() => prepareUnsignedReleaseBundle({ sourceDirectory: source, outputDirectory: output, metadata: metadata() }))
			.toThrow(ReleasePreparationError);
		expect(readFileSync(join(output, "keep.txt"), "utf8")).toBe("keep");
	});

	it.each([
		["invalid metadata", (source: string, output: string) => ({ sourceDirectory: source, outputDirectory: output, metadata: { ...metadata(), version: "bad" } })],
		["unknown metadata", (source: string, output: string) => ({ sourceDirectory: source, outputDirectory: output, metadata: { ...metadata(), unexpected: true } })],
		["missing source", (_source: string, output: string) => ({ sourceDirectory: join(output, "missing"), outputDirectory: output, metadata: metadata() })],
	])("cleans its partial directory after %s", (_label, createInput) => {
		const { root, source, output } = fixture();
		expect(() => prepareUnsignedReleaseBundle(createInput(source, output))).toThrow();
		expect(existsSync(output)).toBe(false);
		expect(readdirSync(root).filter((name) => name.includes(".partial-"))).toEqual([]);
	});
});
