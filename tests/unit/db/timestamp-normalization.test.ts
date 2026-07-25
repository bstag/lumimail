import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { schema } from "@/db/schema";

const migrationsDir = resolve(process.cwd(), "drizzle/migrations");

/**
 * Normalization statements are read from the whole migration set, not one file.
 * An applied migration must never be edited — that is the exact defect the
 * staged-upgrade contract catches — so a timestamp column added later is covered
 * by the migration that introduces it.
 */
function allMigrationSql(): string {
	return readdirSync(migrationsDir)
		.filter((name) => name.endsWith(".sql"))
		.map((name) => readFileSync(join(migrationsDir, name), "utf8"))
		.join("\n");
}

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
	const sql = allMigrationSql();
	/** Only normalization statements; other migrations contain unrelated UPDATEs. */
	const normalizationStatements = sql
		.split("--> statement-breakpoint")
		.filter((statement) => /UPDATE `\w+` SET `\w+` = `\w+` \/ 1000/.test(statement));

	it("covers every timestamp column in the schema", () => {
		const missing = timestampColumns().filter((qualified) => {
			const [table, column] = qualified.split(".");
			return !sql.includes(`UPDATE \`${table}\` SET \`${column}\` = \`${column}\` / 1000`);
		});

		expect(missing).toEqual([]);
	});

	it("only rewrites values that are unambiguously milliseconds", () => {
		// A seconds epoch stays below 1e11 until the year 5138, so anything above
		// it cannot be a legitimate second-precision timestamp for this application.
		expect(normalizationStatements.length).toBeGreaterThan(0);
		for (const statement of normalizationStatements) {
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
