import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0033_add_mcp_connections_and_idempotency.sql"), "utf8");

describe("0033 MCP lifecycle migration", () => {
	it("stores no OAuth credential material and enforces one send per connection key", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(`
				PRAGMA foreign_keys = ON;
				CREATE TABLE organizations (id text PRIMARY KEY NOT NULL);
				CREATE TABLE users (id text PRIMARY KEY NOT NULL);
				CREATE TABLE messages (id text PRIMARY KEY NOT NULL);
				CREATE TABLE outbound_jobs (id text PRIMARY KEY NOT NULL);
				INSERT INTO organizations VALUES ('org_1');
				INSERT INTO users VALUES ('usr_1');
				INSERT INTO messages VALUES ('msg_1');
				INSERT INTO outbound_jobs VALUES ('job_1');
			`);
			db.exec(migration);

			const connectionColumns = (db.prepare("PRAGMA table_info(mcp_connections)").all() as Array<{ name: string }>).map((row) => row.name);
			expect(connectionColumns).toEqual([
				"id", "user_id", "organization_id", "approving_session_id", "client_id", "client_name",
				"profile", "scopes", "status", "created_at", "last_used_at", "revoked_at",
			]);
			expect(connectionColumns).not.toEqual(expect.arrayContaining([
				"access_token", "refresh_token", "authorization_code", "client_secret", "code_verifier",
			]));

			db.prepare(`INSERT INTO mcp_connections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("mcp_1", "usr_1", "org_1", "sess_1", "client_1", "Client", "actions", '["mail.read","mail.actions"]', "active", 1, null, null);
			db.prepare(`INSERT INTO outbound_idempotency VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("idem_1", "mcp", "mcp_1", "request_0123456789", "hash_1", "msg_1", "job_1", 1);
			expect(() => db.prepare(`INSERT INTO outbound_idempotency VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("idem_2", "mcp", "mcp_1", "request_0123456789", "hash_1", "msg_1", "job_1", 2)).toThrow(/UNIQUE/);
		} finally {
			db.close();
		}
	});
});
