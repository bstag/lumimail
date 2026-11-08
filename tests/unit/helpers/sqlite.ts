import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { AppDatabase } from "@/db";

const migrationsDirectory = resolve(__dirname, "../../../drizzle/migrations");

let migrationSql: string[] | null = null;

function migrationStatements(): string[] {
	migrationSql ??= readdirSync(migrationsDirectory)
		.filter((name) => /^\d{4}_.+\.sql$/.test(name))
		.sort()
		.flatMap((name) => readFileSync(join(migrationsDirectory, name), "utf8").split("--> statement-breakpoint"))
		.map((statement) => statement.trim())
		.filter(Boolean);
	return migrationSql;
}

/**
 * An in-memory SQLite database built from the real migrations, with a Drizzle instance over it.
 * Foreign keys are off so a test can seed only the rows it cares about.
 */
export function createMigratedDb(): { sqlite: DatabaseSync; db: AppDatabase } {
	const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
	for (const statement of migrationStatements()) sqlite.exec(statement);
	const db = drizzle(async (query, params, method) => {
		const statement = sqlite.prepare(query);
		if (method === "run") {
			statement.run(...(params as never[]));
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		const rows = statement.all(...(params as never[])) as unknown as unknown[][];
		return { rows: method === "get" ? (rows[0] ?? []) as unknown as unknown[][] : rows };
	}) as unknown as AppDatabase;
	return { sqlite, db };
}

/** Inserts an inbound received message with sensible defaults; `fields` uses column names. */
export function seedMessage(sqlite: DatabaseSync, fields: Record<string, string | number | null>) {
	const row: Record<string, string | number | null> = {
		user_id: "u1", direction: "inbound", from_addr: "a@x.test", to_addr: "me@x.test", subject: "",
		snippet: "", status: "received", attachment_status: "none", read: 0, starred: 0, created_at: 1_000,
		...fields,
	};
	const columns = Object.keys(row);
	sqlite.prepare(`INSERT INTO messages (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
		.run(...Object.values(row));
}
