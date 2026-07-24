import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("inbound attachment status migration", () => {
	it("adds truthful attachment ingestion state to existing messages", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(`CREATE TABLE messages (id text PRIMARY KEY NOT NULL)`);
		const sql = readFileSync(
			resolve(process.cwd(), "drizzle/migrations/0014_add_inbound_attachment_status.sql"),
			"utf8",
		);
		db.exec(sql);
		db.prepare(`INSERT INTO messages (id) VALUES (?)`).run("m1");

		const columns = db.prepare(`PRAGMA table_info(messages)`).all();
		expect(columns.map((column) => column.name)).toEqual([
			"id",
			"attachment_status",
			"attachment_error",
		]);
		expect(db.prepare(`
			SELECT attachment_status, attachment_error FROM messages WHERE id = ?
		`).get("m1")).toEqual({
			attachment_status: "none",
			attachment_error: null,
		});
		db.close();
	});
});
