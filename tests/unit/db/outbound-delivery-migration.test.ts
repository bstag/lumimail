import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("durable outbound delivery migration", () => {
	it("adds claim, attempt, and operational inspection fields to existing jobs", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(`
			CREATE TABLE outbound_jobs (
				id text PRIMARY KEY NOT NULL,
				user_id text NOT NULL,
				message_id text,
				status text DEFAULT 'queued' NOT NULL,
				payload text NOT NULL,
				error text,
				created_at integer NOT NULL,
				updated_at integer NOT NULL
			);
			INSERT INTO outbound_jobs (
				id, user_id, message_id, status, payload, created_at, updated_at
			) VALUES (
				'job_1', 'user_1', 'msg_1', 'queued', '{}', 1, 1
			);
		`);

		const sql = readFileSync(
			resolve(process.cwd(), "drizzle/migrations/0012_add_outbound_delivery_claims.sql"),
			"utf8",
		);
		db.exec(sql);

		expect(db.prepare(`
			SELECT attempts, delivery_token, last_attempt_at
			FROM outbound_jobs
			WHERE id = 'job_1'
		`).get()).toEqual({
			attempts: 0,
			delivery_token: null,
			last_attempt_at: null,
		});
		expect(db.prepare(`
			SELECT name
			FROM sqlite_master
			WHERE type = 'index' AND name = 'outbound_jobs_status_updated_idx'
		`).get()).toEqual({ name: "outbound_jobs_status_updated_idx" });
		db.close();
	});
});
