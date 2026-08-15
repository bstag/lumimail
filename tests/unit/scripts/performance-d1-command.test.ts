import { describe, expect, it, vi } from "vitest";

import {
	runManagedD1Evidence,
	runManagedD1EvidenceCommand,
} from "../../../scripts/performance-d1.mjs";

function output(index = 0, overrides: Record<string, unknown> = {}) {
	return JSON.stringify([{
		results: [{ statement: index }],
		success: true,
		meta: {
			timings: { sql_duration_ms: 0.25 },
			rows_read: 2,
			rows_written: 0,
			served_by_region: "WNAM",
			...overrides,
		},
	}]);
}

describe("runManagedD1Evidence", () => {
	it("executes each fixed statement through the remote query endpoint and returns content-free metadata", () => {
		let index = 0;
		const runWrangler = vi.fn((_args: string[]) => output(index++));
		const report = runManagedD1Evidence({ runWrangler,
			now: () => new Date("2026-08-13T23:30:00.000Z") });

		expect(runWrangler).toHaveBeenCalledTimes(8);
		for (const [args] of runWrangler.mock.calls) {
			expect(args.slice(0, 4)).toEqual(["d1", "execute", "DB", "--remote"]);
			expect(args.at(-1)).toBe("--json");
			expect(args).toContain("--command");
			expect(args).not.toContain("--file");
		}
		expect(report!).toEqual(expect.objectContaining({
			format: "lumimail-managed-d1-performance-v1",
			observedAt: "2026-08-13T23:30:00.000Z",
			statementCount: 8,
			totalSqlDurationMs: 2,
			totalRowsRead: 16,
			totalRowsWritten: 0,
			regions: ["WNAM"],
		}));
		expect(report!.statements).toHaveLength(8);
	});

	it.each([
		"DELETE FROM messages;",
		"PRAGMA table_info(messages);",
		"SELECT subject FROM messages;",
		"SELECT payload FROM outbound_jobs;",
	])("refuses unsafe SQL before invoking Wrangler: %s", (sqlText) => {
		const runWrangler = vi.fn();
		expect(() => runManagedD1Evidence({ sqlText, runWrangler })).toThrow(
			"Managed D1 performance evidence could not be measured",
		);
		expect(runWrangler).not.toHaveBeenCalled();
	});

	it.each([
		["malformed", "not-json"],
		["failed", JSON.stringify([{ results: [], success: false, meta: {} }])],
		["writes", output(0, { rows_written: 1 })],
		["private runner failure", new Error("PRIVATE")],
	])("fails safely for %s", (_name, result) => {
		const runWrangler = result instanceof Error ? vi.fn(() => { throw result; }) : vi.fn(() => result);
		expect(() => runManagedD1Evidence({ runWrangler })).toThrow(
			"Managed D1 performance evidence could not be measured",
		);
		try {
			runManagedD1Evidence({ runWrangler });
		} catch (error) {
			expect(String(error)).not.toContain("PRIVATE");
		}
	});

	it("rejects an invalid observation time", () => {
		expect(() => runManagedD1Evidence({ runWrangler: vi.fn(), now: () => new Date(Number.NaN) }))
			.toThrow("Managed D1 performance evidence could not be measured");
	});
});

describe("runManagedD1EvidenceCommand", () => {
	it("prints the report and returns zero", () => {
		const stdout = vi.fn();
		expect(runManagedD1EvidenceCommand([], { stdout, stderr: vi.fn(), run: vi.fn().mockReturnValue({
			format: "lumimail-managed-d1-performance-v1",
			observedAt: "2026-08-13T23:30:00.000Z",
			statementCount: 8,
			totalSqlDurationMs: 2,
			totalRowsRead: 16,
			totalRowsWritten: 0,
			regions: ["WNAM"],
			statements: [],
		}) })).toBe(0);
		expect(JSON.parse(stdout.mock.calls[0][0])).toEqual(expect.objectContaining({ totalRowsWritten: 0 }));
	});

	it("rejects arguments and bounds failures", () => {
		const stderr = vi.fn();
		expect(runManagedD1EvidenceCommand(["extra"], { stdout: vi.fn(), stderr })).toBe(1);
		expect(stderr).toHaveBeenLastCalledWith("Usage: node scripts/performance-d1.mjs");
		expect(runManagedD1EvidenceCommand([], { stdout: vi.fn(), stderr,
			run: vi.fn(() => { throw new Error("PRIVATE"); }) })).toBe(1);
		expect(stderr).toHaveBeenLastCalledWith("Managed D1 performance evidence could not be measured.");
	});
});
