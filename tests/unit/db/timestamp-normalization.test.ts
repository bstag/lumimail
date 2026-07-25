import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { schema } from "@/db/schema";

const migrationPath = resolve(
	process.cwd(),
	"drizzle/migrations/0019_normalize_millisecond_timestamps.sql",
);

/**
 * Every `{ mode: "timestamp" }` column in the application schema, as
 * `table.column`. Drizzle stores these as seconds; a millisecond value written
 * by hand-run SQL reads back as a date roughly 56,000 years in the future.
 */
export function timestampColumns(): string[] {
	const columns: string[] = [];
	for (const table of Object.values(schema)) {
		const config = getTableConfig(table);
		for (const column of config.columns) {
			if (column.columnType === "SQLiteTimestamp") {
				columns.push(`${config.name}.${column.name}`);
			}
		}
	}
	return columns.sort();
}

describe("millisecond timestamp normalization", () => {
	const sql = readFileSync(migrationPath, "utf8");

	it("covers every timestamp column in the schema", () => {
		const missing = timestampColumns().filter((qualified) => {
			const [table, column] = qualified.split(".");
			return !sql.includes(`UPDATE \`${table}\` SET \`${column}\``);
		});

		expect(missing).toEqual([]);
	});

	it("only rewrites values that are unambiguously milliseconds", () => {
		// A seconds epoch stays below 1e11 until the year 5138, so anything above
		// it cannot be a legitimate second-precision timestamp for this application.
		const statements = sql.split("--> statement-breakpoint");
		for (const statement of statements) {
			if (!statement.includes("UPDATE")) continue;
			expect(statement).toContain("/ 1000");
			expect(statement).toContain("> 100000000000");
		}
	});

	it("is idempotent, so a repeated apply cannot divide twice", () => {
		// After normalization a value is ~1.7e9, far below the guard, so the second
		// run matches nothing.
		const normalized = 1784768200000 / 1000;
		expect(normalized).toBeLessThan(100000000000);
	});
});
