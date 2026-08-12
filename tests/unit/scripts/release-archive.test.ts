import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import {
	ReleaseArchiveError,
	createDeterministicTarGzip,
	writeReleaseArchive,
} from "../../../scripts/release-archive.mjs";

const temporary: string[] = [];

afterEach(() => {
	for (const path of temporary) rmSync(path, { recursive: true, force: true });
	temporary.length = 0;
});

function tarEntries(archive: Uint8Array) {
	const tar = gunzipSync(archive);
	const entries: Array<{ path: string; mode: string; mtime: string; type: string; bytes: Buffer }> = [];
	for (let offset = 0; offset + 512 <= tar.length;) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const text = (start: number, length: number) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/, "");
		const size = Number.parseInt(text(124, 12).trim() || "0", 8);
		const name = text(0, 100);
		const prefix = text(345, 155);
		entries.push({
			path: prefix ? `${prefix}/${name}` : name,
			mode: text(100, 8),
			mtime: text(136, 12),
			type: text(156, 1),
			bytes: tar.subarray(offset + 512, offset + 512 + size),
		});
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return entries;
}

describe("deterministic release archive", () => {
	it("produces identical sorted USTAR/gzip bytes with normalized metadata", () => {
		const entries = [
			{ path: "worker.js", type: "file", bytes: Buffer.from("worker") },
			{ path: "assets", type: "directory" },
			{ path: "assets/app.css", type: "file", bytes: Buffer.from("css") },
		] as const;
		const first = createDeterministicTarGzip(entries);
		const second = createDeterministicTarGzip([...entries].reverse());
		expect(first).toEqual(second);
		expect(first[3]).toBe(0);
		expect(first.subarray(4, 8)).toEqual(Buffer.alloc(4));
		expect(first[9]).toBe(255);
		expect(tarEntries(first)).toEqual([
			expect.objectContaining({ path: "assets/", mode: "0000755", mtime: "00000000000", type: "5", bytes: Buffer.alloc(0) }),
			expect.objectContaining({ path: "assets/app.css", mode: "0000644", mtime: "00000000000", type: "0", bytes: Buffer.from("css") }),
			expect.objectContaining({ path: "worker.js", mode: "0000644", mtime: "00000000000", type: "0", bytes: Buffer.from("worker") }),
		]);
	});

	it("changes when one source byte changes", () => {
		const first = createDeterministicTarGzip([{ path: "worker.js", type: "file", bytes: Buffer.from("a") }]);
		const second = createDeterministicTarGzip([{ path: "worker.js", type: "file", bytes: Buffer.from("b") }]);
		expect(first).not.toEqual(second);
	});

	it.each([
		["traversal", [{ path: "../secret", type: "file", bytes: Buffer.from("x") }]],
		["absolute", [{ path: "/root", type: "file", bytes: Buffer.from("x") }]],
		["backslash", [{ path: "a\\b", type: "file", bytes: Buffer.from("x") }]],
		["duplicate", [{ path: "a", type: "file", bytes: Buffer.from("x") }, { path: "a", type: "file", bytes: Buffer.from("x") }]],
		["unsupported", [{ path: "link", type: "symlink", bytes: Buffer.alloc(0) }]],
		["long segment", [{ path: "a".repeat(101), type: "file", bytes: Buffer.from("x") }]],
	])("rejects %s entries", (_label, entries) => {
		expect(() => createDeterministicTarGzip(entries)).toThrow(ReleaseArchiveError);
	});

	it("writes atomically and source mtimes do not affect output", () => {
		const root = mkdtempSync(join(tmpdir(), "lumimail-release-source-"));
		const outputRoot = mkdtempSync(join(tmpdir(), "lumimail-release-output-"));
		temporary.push(root, outputRoot);
		mkdirSync(join(root, "empty"));
		mkdirSync(join(root, "assets"));
		writeFileSync(join(root, "worker.js"), "worker");
		writeFileSync(join(root, "assets", "app.css"), "css");
		const firstPath = join(outputRoot, "first.tar.gz");
		const secondPath = join(outputRoot, "second.tar.gz");
		const first = writeReleaseArchive(root, firstPath);
		utimesSync(join(root, "worker.js"), new Date("2030-01-01"), new Date("2030-01-01"));
		const second = writeReleaseArchive(root, secondPath);
		expect(readFileSync(firstPath)).toEqual(readFileSync(secondPath));
		expect(first).toEqual({ archiveSize: readFileSync(firstPath).length, entryCount: 4, outputPath: firstPath });
		expect(second.entryCount).toBe(4);
	});

	it("refuses an existing output without changing it", () => {
		const root = mkdtempSync(join(tmpdir(), "lumimail-release-source-"));
		const outputRoot = mkdtempSync(join(tmpdir(), "lumimail-release-output-"));
		temporary.push(root, outputRoot);
		writeFileSync(join(root, "worker.js"), "worker");
		const output = join(outputRoot, "release.tar.gz");
		writeFileSync(output, "existing");
		expect(() => writeReleaseArchive(root, output)).toThrow(ReleaseArchiveError);
		expect(readFileSync(output, "utf8")).toBe("existing");
	});

	it("refuses a missing source with a content-free archive error", () => {
		const outputRoot = mkdtempSync(join(tmpdir(), "lumimail-release-output-"));
		temporary.push(outputRoot);
		expect(() => writeReleaseArchive(join(outputRoot, "missing"), join(outputRoot, "release.tar.gz")))
			.toThrow(ReleaseArchiveError);
	});
});
