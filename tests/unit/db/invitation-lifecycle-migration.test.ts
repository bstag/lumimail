import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0031_add_invitation_lifecycle.sql"), "utf8");

describe("0031 invitation lifecycle migration", () => {
	it("backfills legacy invitations safely and adds the organization history index", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(`
				CREATE TABLE organizations (id text PRIMARY KEY NOT NULL);
				CREATE TABLE org_invites (
					id text PRIMARY KEY NOT NULL, organization_id text NOT NULL, email text NOT NULL,
					role text NOT NULL, token text NOT NULL, expires_at integer NOT NULL, created_at integer NOT NULL
				);
				INSERT INTO organizations VALUES ('org_1');
				INSERT INTO org_invites VALUES ('inv_1', 'org_1', 'legacy@example.com', 'member', 'hash', 20, 10);
			`);
			db.exec(migration);
			const row = db.prepare(`
				SELECT delivery_status, last_delivery_attempt_at, last_delivered_at, accepted_at
				FROM org_invites WHERE id = 'inv_1'
			`).get();
			expect(row).toEqual({
				delivery_status: "not_sent",
				last_delivery_attempt_at: null,
				last_delivered_at: null,
				accepted_at: null,
			});
			const indexes = (db.prepare("PRAGMA index_list(org_invites)").all() as Array<{ name: string }>).map((item) => item.name);
			expect(indexes).toContain("org_invites_org_created_idx");
		} finally {
			db.close();
		}
	});
});
