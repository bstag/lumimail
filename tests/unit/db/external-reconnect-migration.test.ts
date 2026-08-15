import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	resolve(process.cwd(), "drizzle/migrations/0038_add_external_oauth_reconnect.sql"),
	"utf8",
);

describe("0038 external OAuth reconnect migration", () => {
	it("binds an optional reconnect target to one-time OAuth state", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec("CREATE TABLE external_oauth_states (id text PRIMARY KEY NOT NULL);");
			db.exec(migration);
			const columns = db.prepare("PRAGMA table_info(external_oauth_states)").all() as Array<{ name: string }>;
			expect(columns.map((column) => column.name)).toContain("reconnect_account_id");
		} finally {
			db.close();
		}
	});
});
