import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("queue health snapshot migration", () => {
	it("creates a deployment-level current snapshot table", () => {
		const db = new DatabaseSync(":memory:");
		const sql = readFileSync(
			resolve(process.cwd(), "drizzle/migrations/0013_add_queue_health_snapshots.sql"),
			"utf8",
		);
		db.exec(sql);

		expect(db.prepare(`
			SELECT name
			FROM sqlite_master
			WHERE type = 'table' AND name = 'queue_health_snapshots'
		`).get()).toEqual({ name: "queue_health_snapshots" });
		expect(db.prepare(`PRAGMA table_info(queue_health_snapshots)`).all().map((column) => column.name)).toEqual([
			"queue_key",
			"status",
			"backlog_count",
			"backlog_bytes",
			"oldest_message_at",
			"stale_job_count",
			"detail",
			"checked_at",
		]);
		db.close();
	});
});
