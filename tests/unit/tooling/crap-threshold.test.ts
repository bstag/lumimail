import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "@barney-media/crap-typescript";
import { afterEach, describe, expect, it } from "vitest";

const temporaryProjects: string[] = [];

afterEach(() => {
	for (const project of temporaryProjects.splice(0)) {
		rmSync(project, { recursive: true, force: true });
	}
});

describe("CRAP threshold enforcement", () => {
	it("returns the documented threshold-exceeded status for a controlled violation", async () => {
		const project = mkdtempSync(path.join(tmpdir(), "lumimail-crap-threshold-"));
		temporaryProjects.push(project);
		const sourceDirectory = path.join(project, "src");
		const coverageDirectory = path.join(project, "coverage");
		const sourcePath = path.join(sourceDirectory, "risky.ts");
		const riskySource = `export function risky(value: number) { ${Array.from({ length: 31 }, (_, index) => `if (value === ${index}) return ${index};`).join(" ")} return -1; }\n`;
		mkdirSync(sourceDirectory);
		mkdirSync(coverageDirectory);
		writeFileSync(
			sourcePath,
			riskySource,
		);
		writeFileSync(
			path.join(coverageDirectory, "coverage-final.json"),
			JSON.stringify({
				[sourcePath]: {
					path: sourcePath,
					statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: riskySource.length - 1 } } },
					fnMap: {
						0: {
							name: "risky",
							decl: { start: { line: 1, column: 16 }, end: { line: 1, column: 21 } },
							loc: { start: { line: 1, column: 0 }, end: { line: 1, column: riskySource.length - 1 } },
							line: 1,
						},
					},
					branchMap: {},
					s: { 0: 0 },
					f: { 0: 0 },
					b: {},
				},
			}),
		);

		const stdout: string[] = [];
		const stderr: string[] = [];
		const status = await runCli(
			["--threshold", "30", "--format", "text", sourcePath],
			project,
			{ write: (value) => { stdout.push(value); } },
			{ write: (value) => { stderr.push(value); } },
		);

		expect(status, `${stdout.join("")}\n${stderr.join("")}`).toBe(2);
		expect(stdout.join("")).toContain("threshold: 30.0");
		expect(stdout.join("")).toContain("risky");
		expect(stderr.join("")).toContain("CRAP threshold exceeded");
	});
});
