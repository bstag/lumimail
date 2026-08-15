import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	ReleaseCommandError,
	parseReleaseCommandArguments,
	prepareReleaseFromCheckout,
	runReleaseCommand,
} from "../../../scripts/release-command.mjs";
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "lumimail-release-command-"));
	roots.push(root);
	mkdirSync(join(root, ".open-next"));
	mkdirSync(join(root, "drizzle", "migrations"), { recursive: true });
	writeFileSync(join(root, "drizzle", "migrations", "0000_init.sql"), "select 1;");
	writeFileSync(join(root, "package.json"), JSON.stringify({
		name: "email-platform",
		version: "1.2.3",
		engines: { node: ">=22" },
	}));
	writeFileSync(join(root, "package-lock.json"), JSON.stringify({
		name: "email-platform",
		version: "1.2.3",
		lockfileVersion: 3,
		packages: {
			"": { name: "email-platform", version: "1.2.3" },
			"node_modules/next": { version: "16.3.0" },
			"node_modules/@opennextjs/cloudflare": { version: "1.20.2" },
			"node_modules/wrangler": { version: "4.114.0" },
		},
	}));
	writeFileSync(join(root, "release.schema.json"), JSON.stringify({
		format: "lumimail-release-schema-v1",
		minimum: "0000",
		maximum: "0000",
	}));
	writeFileSync(join(root, "notes.json"), JSON.stringify(["Private launch note"]));
	return root;
}

describe("release preparation command", () => {
	it("accepts exactly the build, notes, and output positional arguments", () => {
		expect(parseReleaseCommandArguments([".open-next", "notes.json", "release-out"])).toEqual({
			sourceDirectory: ".open-next",
			notesPath: "notes.json",
			outputDirectory: "release-out",
		});
		for (const args of [[], ["one"], ["one", "two"], ["one", "two", "three", "four"]]) {
			expect(() => parseReleaseCommandArguments(args)).toThrow(ReleaseCommandError);
		}
	});

	it("derives immutable checkout inputs and passes no operator provenance overrides", () => {
		const root = fixture();
		const prepareBundle = vi.fn(() => ({
			archiveSize: 42,
			entryCount: 3,
			outputDirectory: join(root, "release-out"),
			version: "1.2.3",
		}));
		const runGit = vi.fn((args: string[]) => {
			if (args[0] === "status") return "";
			if (args[0] === "rev-parse") return "a".repeat(40);
			if (args[0] === "show") return "1700000000\n";
			throw new Error("unexpected git call");
		});
		const report = prepareReleaseFromCheckout({
			rootDirectory: root,
			sourceDirectory: ".open-next",
			notesPath: "notes.json",
			outputDirectory: "release-out",
			runGit,
			nodeVersion: "22.16.0",
			prepareBundle,
		});

		expect(report).toEqual({
			archiveSize: 42,
			commit: "a".repeat(40),
			entryCount: 3,
			outputDirectory: join(root, "release-out"),
			schema: { current: "0000", maximum: "0000", minimum: "0000" },
			version: "1.2.3",
		});
		expect(runGit).toHaveBeenCalledWith(["show", "-s", "--format=%ct", "HEAD"]);
		expect(prepareBundle).toHaveBeenCalledWith({
			sourceDirectory: join(root, ".open-next"),
			outputDirectory: join(root, "release-out"),
			metadata: expect.objectContaining({
				builtAt: "2023-11-14T22:13:20.000Z",
				commit: "a".repeat(40),
				notes: ["Private launch note"],
			}),
		});
	});

	it("does not invoke bundle preparation for malformed private notes", () => {
		const root = fixture();
		writeFileSync(join(root, "notes.json"), '"Private launch note"');
		const prepareBundle = vi.fn();
		const runGit = (args: string[]) => {
			if (args[0] === "status") return "";
			if (args[0] === "rev-parse") return "a".repeat(40);
			if (args[0] === "show") return "1700000000";
			throw new Error("unexpected git call");
		};
		expect(() => prepareReleaseFromCheckout({
			rootDirectory: root,
			sourceDirectory: ".open-next",
			notesPath: "notes.json",
			outputDirectory: "release-out",
			runGit,
			nodeVersion: "22.16.0",
			prepareBundle,
		})).toThrow(ReleaseCommandError);
		expect(prepareBundle).not.toHaveBeenCalled();
	});

	it("prints a bounded success report without release-note contents", () => {
		const root = fixture();
		const stdout = vi.fn();
		const stderr = vi.fn();
		const code = runReleaseCommand([".open-next", "notes.json", "release-out"], {
			rootDirectory: root,
			stdout,
			stderr,
			prepare: () => ({
				archiveSize: 42,
				commit: "a".repeat(40),
				entryCount: 3,
				outputDirectory: join(root, "release-out"),
				schema: { current: "0000", minimum: "0000", maximum: "0000" },
				version: "1.2.3",
			}),
		});
		expect(code).toBe(0);
		expect(stderr).not.toHaveBeenCalled();
		expect(stdout).toHaveBeenCalledOnce();
		expect(stdout.mock.calls[0][0]).toContain("1.2.3 aaaaaaaa schema 0000-0000");
		expect(stdout.mock.calls[0][0]).not.toContain("Private launch note");
	});

	it("collapses arbitrary failures into one content-free error", () => {
		const stdout = vi.fn();
		const stderr = vi.fn();
		const code = runReleaseCommand(["source", "notes", "output"], {
			rootDirectory: ".",
			stdout,
			stderr,
			prepare: () => { throw new Error("Private launch note"); },
		});
		expect(code).toBe(1);
		expect(stdout).not.toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledWith("Release preparation failed. No release bundle was published.");
		expect(stderr.mock.calls[0][0]).not.toContain("Private launch note");
	});
});
