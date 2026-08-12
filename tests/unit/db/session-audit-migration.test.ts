import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0030_add_security_audit_events.sql"), "utf8");

describe("0030 security-audit migration", () => {
	it("creates the bounded content-free audit contract and organization indexes", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec("PRAGMA foreign_keys = ON; CREATE TABLE organizations (id text PRIMARY KEY NOT NULL); INSERT INTO organizations VALUES ('org_1');");
			db.exec(migration);
			const columns = (db.prepare("PRAGMA table_info(security_audit_events)").all() as Array<{ name: string }>).map((row) => row.name);
			expect(columns).toEqual([
				"id", "organization_id", "actor_user_id", "action", "resource_type", "resource_id",
				"affected_count", "request_id", "outcome", "created_at",
			]);
			expect(columns).not.toEqual(expect.arrayContaining(["token", "password", "email", "ip_address", "user_agent", "body"]));
			const indexes = (db.prepare("PRAGMA index_list(security_audit_events)").all() as Array<{ name: string }>).map((row) => row.name);
			expect(indexes).toEqual(expect.arrayContaining([
				"security_audit_events_org_created_idx", "security_audit_events_request_idx",
			]));
		} finally {
			db.close();
		}
	});

	it("keeps audit action and resource values extensible without a follow-up migration", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec("PRAGMA foreign_keys = ON; CREATE TABLE organizations (id text PRIMARY KEY NOT NULL); INSERT INTO organizations VALUES ('org_1');");
			db.exec(migration);
			db.prepare(`
				INSERT INTO security_audit_events (
					id, organization_id, actor_user_id, action, resource_type, resource_id,
					affected_count, request_id, outcome, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				"aud_1", "org_1", "usr_owner", "mailbox.grant_bulk", "mailbox_membership",
				"usr_member", 2, "req_1", "succeeded", 1,
			);
			const event = db.prepare("SELECT action, resource_type FROM security_audit_events WHERE id = ?")
				.get("aud_1");
			expect(event).toEqual({ action: "mailbox.grant_bulk", resource_type: "mailbox_membership" });
		} finally {
			db.close();
		}
	});
});
