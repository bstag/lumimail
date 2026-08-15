import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	resolve(process.cwd(), "drizzle/migrations/0037_add_external_mail_accounts.sql"),
	"utf8",
);

describe("0037 external mail account migration", () => {
	it("separates encrypted credentials, remote identities, cursors, jobs, and retained originals", () => {
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

			expect(columns("external_accounts")).toEqual([
				"id", "organization_id", "mailbox_id", "owner_user_id", "approving_session_id",
				"provider", "external_address", "token_ciphertext", "token_iv", "token_key_id",
				"status", "import_mode", "retain_original", "last_sync_at", "last_error_code",
				"created_at", "updated_at", "revoked_at",
			]);
			expect(columns("external_oauth_states")).not.toEqual(expect.arrayContaining([
				"state", "authorization_code", "refresh_token", "code_verifier",
			]));
			expect(columns("external_sync_cursors")).not.toEqual(expect.arrayContaining(["cursor"]));

			db.prepare(`INSERT INTO external_accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run(
					"exa_1", "org_1", "mbx_1", "usr_1", "sess_1", "google", "user@example.com",
					"cipher", "iv", "v1", "active", "from_now", 0, null, null, 1, 1, null,
				);
			expect(() => db.prepare(`INSERT INTO external_accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run(
					"exa_2", "org_1", "mbx_1", "usr_1", "sess_1", "google", "USER@example.com",
					"cipher", "iv", "v1", "active", "from_now", 0, null, null, 1, 1, null,
				)).toThrow(/UNIQUE/);

			db.prepare(`INSERT INTO external_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("exm_1", "exa_1", "remote_1", null, "inbox", "msg_1", null, 1, 1, null);
			expect(() => db.prepare(`INSERT INTO external_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.run("exm_2", "exa_1", "remote_1", null, "sent", "msg_1", null, 1, 1, null))
				.toThrow(/UNIQUE/);
		} finally {
			db.close();
		}
	});
});
