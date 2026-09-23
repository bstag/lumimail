import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "@/db";

const m = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/db", () => ({ getDb: () => m.db }));

import { resolveSenderAuthorization } from "@/lib/email/outbound/authorization";

let sqlite: DatabaseSync;

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			organization_id TEXT
		);
		CREATE TABLE organization_members (
			user_id TEXT NOT NULL,
			organization_id TEXT NOT NULL
		);
		CREATE TABLE domains (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			organization_id TEXT,
			hostname TEXT NOT NULL,
			zone_id TEXT NOT NULL,
			status TEXT NOT NULL,
			routing_status TEXT,
			sending_subdomain_tag TEXT,
			sending_enabled INTEGER NOT NULL DEFAULT 0,
			routing_enabled INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE mailboxes (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			organization_id TEXT,
			domain_id TEXT NOT NULL,
			local_part TEXT NOT NULL,
			display_name TEXT
		);
		CREATE TABLE mailbox_memberships (
			mailbox_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			role TEXT NOT NULL
		);
	`);
	m.db = drizzle(async (sql, params, method) => {
		const statement = sqlite.prepare(sql);
		if (method === "run") {
			statement.run(...params);
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		return { rows: statement.all(...params) as unknown as unknown[][] };
	}) as unknown as AppDatabase;
});

afterEach(() => sqlite.close());

describe("sender authorization against SQLite", () => {
	it("does not fall back to an organization mailbox after membership removal", async () => {
		sqlite.exec(`
			INSERT INTO users (id, organization_id) VALUES ('usr_removed', NULL);
			INSERT INTO domains (id, user_id, organization_id, hostname, zone_id, status)
			VALUES ('dom_org', 'usr_removed', 'org_1', 'org.example', 'zone_1', 'active');
			INSERT INTO mailboxes (id, user_id, organization_id, domain_id, local_part)
			VALUES ('mb_org', 'usr_removed', 'org_1', 'dom_org', 'sender');
		`);

		await expect(
			resolveSenderAuthorization({} as CloudflareEnv, "usr_removed", "sender@org.example"),
		).resolves.toBeNull();
	});

	it("continues to authorize a genuinely personal mailbox", async () => {
		sqlite.exec(`
			INSERT INTO users (id, organization_id) VALUES ('usr_personal', NULL);
			INSERT INTO domains (id, user_id, organization_id, hostname, zone_id, status)
			VALUES ('dom_personal', 'usr_personal', NULL, 'personal.example', 'zone_1', 'active');
			INSERT INTO mailboxes (id, user_id, organization_id, domain_id, local_part)
			VALUES ('mb_personal', 'usr_personal', NULL, 'dom_personal', 'sender');
		`);

		await expect(
			resolveSenderAuthorization({} as CloudflareEnv, "usr_personal", "sender@personal.example"),
		).resolves.toMatchObject({
			mailboxId: "mb_personal",
			organizationId: null,
		});
	});
});
