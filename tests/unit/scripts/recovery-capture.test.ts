import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureRecovery } from "../../../scripts/recovery-capture.mjs";
import { parseRecoveryManifest } from "../../../scripts/recovery-manifest.mjs";

const temporary: string[] = [];
const workerVersion = "74b98ae8-484f-4262-9a02-0f224bc8e5cd";

afterEach(() => {
	for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
	temporary.length = 0;
});

function configFixture() {
	return {
		accountId: "caddde404ba5d0324c315dc5cf143696",
		workerName: "lumimail",
		compatibilityDate: "2026-07-22",
		d1: {
			binding: "DB",
			id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42",
			name: "lumimail-prod",
		},
		r2: { binding: "BUCKET", bucketName: "lumimail-raw-prod" },
	};
}

function outputDirectory(): string {
	const parent = mkdtempSync(join(tmpdir(), "lumimail-capture-test-"));
	temporary.push(parent);
	return join(parent, "backup");
}

function providerResponses(overrides?: { deployment?: unknown; version?: unknown }) {
	return {
		deployment:
			overrides?.deployment ??
			({ versions: [{ version_id: workerVersion, percentage: 100 }] } as const),
		version:
			overrides?.version ??
			({
				id: workerVersion,
				resources: {
					script: { etag: "6aff".padEnd(64, "0") },
					script_runtime: { compatibility_date: "2026-07-22" },
					bindings: [
						{
							name: "DB",
							type: "d1",
							database_id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42",
						},
						{
							name: "BUCKET",
							type: "r2_bucket",
							bucket_name: "lumimail-raw-prod",
						},
					],
				},
			} as const),
	};
}

function runner(overrides?: { deployment?: unknown; version?: unknown; missingKey?: string }) {
	const responses = providerResponses(overrides);
	return vi.fn((args: string[]) => {
		if (args[0] === "deployments") return JSON.stringify(responses.deployment);
		if (args[0] === "versions") return JSON.stringify(responses.version);
		if (args[0] === "d1" && args[1] === "time-travel") {
			return JSON.stringify({ bookmark: "bookmark-1" });
		}
		if (args[0] === "d1" && args[1] === "export") {
			const path = args[args.indexOf("--output") + 1];
			writeFileSync(
				path,
				"INSERT INTO x VALUES('attachments/u1/m1/a1','inbound/1.eml');",
			);
			return "";
		}
		if (args[0] === "r2" && args[1] === "object" && args[2] === "get") {
			const objectPath = args[3];
			const key = objectPath.slice("lumimail-raw-prod/".length);
			if (key === overrides?.missingKey) throw new Error("provider missing");
			const path = args[args.indexOf("--file") + 1];
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, key === "inbound/1.eml" ? "mime" : "attachment");
			return "";
		}
		throw new Error(`unexpected Wrangler command: ${args.join(" ")}`);
	});
}

function capture(overrides?: {
	outputDirectory?: string;
	gitClean?: boolean;
	runWrangler?: ReturnType<typeof runner>;
}) {
	return captureRecovery({
		outputDirectory: overrides?.outputDirectory ?? outputDirectory(),
		config: configFixture(),
		gitCommit: "d53b475634700039e8338eaa8913094079a24bec",
		gitClean: overrides?.gitClean ?? true,
		migrationNames: ["0027_add.sql", "README.md", "0028_labels.sql"],
		now: () => new Date("2026-08-12T13:30:00.000Z"),
		runWrangler: overrides?.runWrangler ?? runner(),
	});
}

describe("captureRecovery", () => {
	it("captures D1 and referenced R2 bytes using read-only commands, verifies, and publishes atomically", () => {
		const output = outputDirectory();
		const runWrangler = runner();

		const result = capture({ outputDirectory: output, runWrangler });
		const manifest = parseRecoveryManifest(
			readFileSync(join(output, "manifest.json"), "utf8"),
		);

		expect(result).toEqual({
			outputDirectory: output,
			workerVersion,
			checkedDatabase: 1,
			checkedObjects: 2,
		});
		expect(manifest.application.gitCommit).toBe(
			"d53b475634700039e8338eaa8913094079a24bec",
		);
		expect(manifest.application.schemaVersion).toBe("0028");
		expect(manifest.source.d1.bookmark).toBe("bookmark-1");
		expect(manifest.objects.map((entry: { key: string }) => entry.key)).toEqual([
			"attachments/u1/m1/a1",
			"inbound/1.eml",
		]);

		const commands = runWrangler.mock.calls.map(([args]) => args.join(" "));
		expect(commands).toEqual([
			"deployments status --name lumimail --json",
			`versions view ${workerVersion} --name lumimail --json`,
			"d1 time-travel info DB --json",
			expect.stringMatching(/^d1 export DB --remote --skip-confirmation --output /),
			expect.stringMatching(
				/^r2 object get lumimail-raw-prod\/attachments\/u1\/m1\/a1 --remote --file /,
			),
			expect.stringMatching(
				/^r2 object get lumimail-raw-prod\/inbound\/1\.eml --remote --file /,
			),
		]);
		expect(commands.join(" ")).not.toMatch(/\b(?:put|delete|execute|restore|deploy)\b/);
	});

	it("refuses a dirty worktree or existing output before provider access", () => {
		const dirtyRunner = runner();
		expect(() => capture({ gitClean: false, runWrangler: dirtyRunner })).toThrow(
			"Git worktree must be clean before production capture",
		);
		expect(dirtyRunner).not.toHaveBeenCalled();

		const existing = outputDirectory();
		mkdirSync(existing);
		const existingRunner = runner();
		expect(() =>
			capture({ outputDirectory: existing, runWrangler: existingRunner }),
		).toThrow("Recovery output path already exists");
		expect(existingRunner).not.toHaveBeenCalled();
	});

	it("rejects split traffic before D1 or R2 access", () => {
		const runWrangler = runner({
			deployment: {
				versions: [
					{ version_id: workerVersion, percentage: 90 },
					{ version_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", percentage: 10 },
				],
			},
		});

		expect(() => capture({ runWrangler })).toThrow(
			"Production must have exactly one Worker version at 100% traffic",
		);
		expect(runWrangler).toHaveBeenCalledTimes(1);
	});

	it("rejects deployed binding drift before exporting D1", () => {
		const responses = providerResponses();
		const mismatched = structuredClone(responses.version) as {
			resources: { bindings: Array<Record<string, unknown>> };
		};
		mismatched.resources.bindings[0].database_id =
			"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
		const runWrangler = runner({ version: mismatched });

		expect(() => capture({ runWrangler })).toThrow(
			"Active Worker D1 binding does not match production configuration",
		);
		expect(runWrangler).toHaveBeenCalledTimes(2);
	});

	it("removes only its partial directory when a referenced object is missing", () => {
		const output = outputDirectory();
		const runWrangler = runner({ missingKey: "inbound/1.eml" });

		expect(() => capture({ outputDirectory: output, runWrangler })).toThrow(
			"A D1-referenced R2 object could not be captured; partial backup removed",
		);
		expect(existsSync(output)).toBe(false);
		expect(readdirSync(dirname(output))).toEqual([]);
	});
});
