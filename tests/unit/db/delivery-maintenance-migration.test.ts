import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const migration = readFileSync("drizzle/migrations/0049_delivery_maintenance.sql", "utf8");

it("checkpoints in-flight native deliveries from the previous schema", () => {
	const db = new DatabaseSync(":memory:");
	try {
		db.exec(`
			CREATE TABLE mailboxes (id TEXT PRIMARY KEY);
			CREATE TABLE messages (id TEXT PRIMARY KEY, mailbox_id TEXT, direction TEXT, created_at INTEGER);
			CREATE TABLE message_bodies (message_id TEXT, raw_r2_key TEXT);
			CREATE TABLE attachments (r2_key TEXT);
			CREATE TABLE push_notification_events (id TEXT PRIMARY KEY, message_id TEXT);
			INSERT INTO mailboxes VALUES ('mailbox-1'), ('mailbox-2');
			INSERT INTO messages VALUES
				('stored-first', 'mailbox-1', 'inbound', 1700000000),
				('duplicate', 'mailbox-1', 'inbound', 1700000001),
				('stored-second', 'mailbox-2', 'inbound', 1700000002),
				('already-finished', 'mailbox-1', 'inbound', 1700000003);
			INSERT INTO message_bodies VALUES
				('stored-first', 'inbound/in-flight.eml'),
				('duplicate', 'inbound/in-flight.eml'),
				('stored-second', 'inbound/in-flight.eml'),
				('already-finished', NULL);
			INSERT INTO push_notification_events VALUES ('push-1', 'stored-first');
		`);
		db.exec(migration);
		expect(db.prepare(`SELECT mailbox_id, message_id, push_event_id, stage FROM inbound_deliveries ORDER BY mailbox_id`).all())
			.toEqual([
				{ mailbox_id: "mailbox-1", message_id: "stored-first", push_event_id: "push-1", stage: "filters" },
				{ mailbox_id: "mailbox-2", message_id: "stored-second", push_event_id: null, stage: "filters" },
			]);
	} finally {
		db.close();
	}
});
