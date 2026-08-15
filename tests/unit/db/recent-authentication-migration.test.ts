import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	resolve(process.cwd(), "drizzle/migrations/0029_add_recent_authentication.sql"),
	"utf8",
);

describe("0029 recent-authentication migration", () => {
	it("preserves authentication age while remaining safe during a rolling deploy", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(`
				PRAGMA foreign_keys = ON;
				CREATE TABLE organizations (id text PRIMARY KEY NOT NULL);
				CREATE TABLE users (id text PRIMARY KEY NOT NULL);
				CREATE TABLE sessions (
					id text PRIMARY KEY NOT NULL,
					user_id text NOT NULL,
					organization_id text,
					token_lookup text NOT NULL,
					token_hash text NOT NULL,
					expires_at integer NOT NULL,
					created_at integer NOT NULL,
					FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade,
					FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE cascade
				);
				CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions (token_hash);
				CREATE UNIQUE INDEX sessions_token_lookup_idx ON sessions (token_lookup);
				CREATE INDEX sessions_user_idx ON sessions (user_id);
				INSERT INTO organizations VALUES ('org_1');
				INSERT INTO users VALUES ('usr_1');
				INSERT INTO sessions VALUES ('sess_1', 'usr_1', 'org_1', 'lookup', 'hash', 2000, 1000);
			`);
			db.exec(migration);

			const row = db.prepare("SELECT created_at, authenticated_at FROM sessions WHERE id = 'sess_1'").get() as Record<string, number>;
			expect(row).toEqual({ created_at: 1000, authenticated_at: 1000 });
			const column = (db.prepare("PRAGMA table_info(sessions)").all() as Array<Record<string, unknown>>)
				.find((entry) => entry.name === "authenticated_at");
			expect(column?.notnull).toBe(0);

			// The pre-0029 Worker does not name authenticated_at during INSERT. Keeping
			// it nullable prevents an outage if publication stops after migration.
			db.exec("INSERT INTO sessions (id, user_id, organization_id, token_lookup, token_hash, expires_at, created_at) VALUES ('sess_2', 'usr_1', 'org_1', 'lookup_2', 'hash_2', 2000, 1000)");
			const rollingRow = db.prepare("SELECT authenticated_at FROM sessions WHERE id = 'sess_2'").get() as Record<string, null>;
			expect(rollingRow.authenticated_at).toBeNull();
		} finally {
			db.close();
		}
	});
});
