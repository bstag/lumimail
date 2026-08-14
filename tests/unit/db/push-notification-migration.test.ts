import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	resolve(process.cwd(), "drizzle/migrations/0036_add_private_push_notifications.sql"),
	"utf8",
);

describe("0036 private push notification migration", () => {
	it("stores delivery credentials separately from content and enforces idempotency", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(`
				PRAGMA foreign_keys = ON;
				CREATE TABLE organizations (id text PRIMARY KEY NOT NULL);
				CREATE TABLE users (id text PRIMARY KEY NOT NULL);
				CREATE TABLE sessions (id text PRIMARY KEY NOT NULL);
				CREATE TABLE mailboxes (id text PRIMARY KEY NOT NULL);
				CREATE TABLE messages (id text PRIMARY KEY NOT NULL);
				INSERT INTO organizations VALUES ('org_1');
				INSERT INTO users VALUES ('usr_1');
				INSERT INTO sessions VALUES ('sess_1');
				INSERT INTO mailboxes VALUES ('mbx_1');
				INSERT INTO messages VALUES ('msg_1');
			`);
			db.exec(migration);

			const columns = (table: string) =>
				(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);

			expect(columns("push_devices")).toEqual([
				"id", "user_id", "organization_id", "approving_session_id", "name", "endpoint",
				"endpoint_hash", "p256dh", "auth", "status", "created_at", "updated_at",
				"last_delivered_at", "revoked_at", "expired_at",
			]);
			expect(columns("push_notification_events")).toEqual([
				"id", "organization_id", "mailbox_id", "message_id", "status", "expansion_cursor",
				"attempts", "next_attempt_at", "lease_until", "created_at", "completed_at",
			]);
			expect(columns("push_deliveries")).toEqual([
				"id", "event_id", "device_id", "status", "attempts", "next_attempt_at", "lease_until",
				"provider_outcome", "created_at", "delivered_at", "terminal_at",
			]);
			expect(columns("push_notification_events")).not.toEqual(expect.arrayContaining([
				"subject", "sender", "snippet", "body", "mailbox_name", "mailbox_address",
			]));
			expect(columns("push_deliveries")).not.toEqual(expect.arrayContaining([
				"subject", "sender", "snippet", "body", "route", "payload",
			]));

			db.prepare(`INSERT INTO push_devices VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run(
					"pud_1", "usr_1", "org_1", "sess_1", "Laptop", "https://fcm.googleapis.com/push/one",
					"hash_1", "p256dh", "auth", "active", 1, 1, null, null, null,
				);
			expect(() => db.prepare(`INSERT INTO push_devices VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run(
					"pud_2", "usr_1", "org_1", "sess_1", "Duplicate", "https://fcm.googleapis.com/push/two",
					"hash_2", "p256dh", "auth", "active", 1, 1, null, null, null,
				)).toThrow(/UNIQUE/);

			db.prepare(`INSERT INTO push_device_mailboxes VALUES (?, ?, ?)`)
				.run("pud_1", "mbx_1", 1);
			expect(() => db.prepare(`INSERT INTO push_device_mailboxes VALUES (?, ?, ?)`)
				.run("pud_1", "mbx_1", 2)).toThrow(/UNIQUE/);

			db.prepare(`INSERT INTO push_notification_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("pue_1", "org_1", "mbx_1", "msg_1", "pending", null, 0, 1, null, 1, null);
			expect(() => db.prepare(`INSERT INTO push_notification_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("pue_2", "org_1", "mbx_1", "msg_1", "pending", null, 0, 1, null, 1, null)).toThrow(/UNIQUE/);

			db.prepare(`INSERT INTO push_deliveries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("pudl_opaque_1", "pue_1", "pud_1", "pending", 0, 1, null, null, 1, null, null);
			expect(() => db.prepare(`INSERT INTO push_deliveries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("pudl_opaque_2", "pue_1", "pud_1", "pending", 0, 1, null, null, 1, null, null)).toThrow(/UNIQUE/);
		} finally {
			db.close();
		}
	});
});
