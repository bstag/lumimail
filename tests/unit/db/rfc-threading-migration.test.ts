import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("RFC threading migration", () => {
	it("adds reply metadata and a mailbox-scoped RFC identity index", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(`CREATE TABLE messages (
			id text PRIMARY KEY NOT NULL,
			mailbox_id text,
			thread_id text
		)`);
		const sql = readFileSync(
			resolve(process.cwd(), "drizzle/migrations/0015_add_rfc_threading.sql"),
			"utf8",
		);
		db.exec(sql);

		const columns = db.prepare(`PRAGMA table_info(messages)`).all();
		expect(columns.map((column) => column.name)).toEqual([
			"id",
			"mailbox_id",
			"thread_id",
			"rfc_message_id",
			"in_reply_to",
			"references_header",
			"reply_source_message_id",
		]);
		const indexes = db.prepare(`PRAGMA index_list(messages)`).all();
		expect(indexes.map((index) => index.name)).toContain("messages_mailbox_rfc_message_idx");
		db.close();
	});
});
