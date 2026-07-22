import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "drizzle/migrations");

function executableMigrationSql(): string {
	return readdirSync(migrationsDirectory)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((name) => readFileSync(resolve(migrationsDirectory, name), "utf8"))
		.join("\n");
}

describe("executable D1 migrations", () => {
	it("create the password reset token table declared by the Drizzle schema", () => {
		const sql = executableMigrationSql();
		const table = sql.match(
			/CREATE TABLE [`"]password_reset_tokens[`"]\s*\(([\s\S]*?)\);/i,
		)?.[1];

		expect(table, "password_reset_tokens must exist in executable migration SQL").toBeDefined();
		expect(table).toMatch(/[`"]id[`"]\s+text\s+PRIMARY KEY\s+NOT NULL/i);
		expect(table).toMatch(/[`"]user_id[`"]\s+text\s+NOT NULL/i);
		expect(table).toMatch(/[`"]token_hash[`"]\s+text\s+NOT NULL/i);
		expect(table).toMatch(/[`"]expires_at[`"]\s+integer\s+NOT NULL/i);
		expect(table).toMatch(/[`"]used[`"]\s+integer\s+DEFAULT false\s+NOT NULL/i);
		expect(table).toMatch(/[`"]created_at[`"]\s+integer\s+NOT NULL/i);
		expect(table).toMatch(
			/FOREIGN KEY\s*\([`"]user_id[`"]\)\s+REFERENCES\s+[`"]users[`"]\s*\([`"]id[`"]\)\s+ON UPDATE no action\s+ON DELETE cascade/i,
		);
	});
});
