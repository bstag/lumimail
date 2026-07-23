import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("mailbox membership migration", () => {
	it("backfills only mailbox owners and message organization IDs", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(`
			PRAGMA foreign_keys = ON;
			CREATE TABLE organizations (id text PRIMARY KEY NOT NULL);
			CREATE TABLE users (id text PRIMARY KEY NOT NULL);
			CREATE TABLE mailboxes (
				id text PRIMARY KEY NOT NULL,
				user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				organization_id text REFERENCES organizations(id) ON DELETE CASCADE
			);
			CREATE TABLE messages (
				id text PRIMARY KEY NOT NULL,
				mailbox_id text REFERENCES mailboxes(id) ON DELETE SET NULL,
				organization_id text REFERENCES organizations(id) ON DELETE CASCADE
			);
			INSERT INTO organizations (id) VALUES ('org_1');
			INSERT INTO users (id) VALUES ('owner_1'), ('member_1');
			INSERT INTO mailboxes (id, user_id, organization_id) VALUES ('mbx_1', 'owner_1', 'org_1');
			INSERT INTO messages (id, mailbox_id, organization_id) VALUES ('msg_1', 'mbx_1', NULL);
		`);

		const sql = readFileSync(
			resolve(process.cwd(), "drizzle/migrations/0010_add_mailbox_memberships.sql"),
			"utf8",
		);
		db.exec(sql);

		const memberships = db.prepare(
			"SELECT mailbox_id, user_id, role FROM mailbox_memberships ORDER BY user_id",
		).all();
		expect(memberships).toEqual([{ mailbox_id: "mbx_1", user_id: "owner_1", role: "manager" }]);
		expect(db.prepare("SELECT organization_id FROM messages WHERE id = 'msg_1'").get()).toEqual({
			organization_id: "org_1",
		});
		db.close();
	});
});
