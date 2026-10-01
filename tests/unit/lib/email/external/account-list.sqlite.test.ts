import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/auth/mailbox-access", () => ({
	listAccessibleMailboxIds: async () => ["mbx_1"],
	getMailboxAccess: async () => null,
}));

import { listExternalAccounts } from "@/lib/email/external/account-management";

let sqlite: DatabaseSync;

function insertAccount(id: string, fields: { status?: string; retryCount?: number; nextRetryAt?: number | null } = {}) {
	sqlite.prepare(`INSERT INTO external_accounts
		(id, organization_id, mailbox_id, owner_user_id, provider, external_address, status, import_mode,
		 retain_original, last_sync_at, last_error_code, error_retry_count, next_retry_at, created_at, updated_at, revoked_at)
		VALUES (?, 'org_1', 'mbx_1', 'usr_1', 'google', ?, ?, 'from_now', 0, NULL, NULL, ?, ?, 1, 1, NULL)`)
		.run(id, `${id}@gmail.com`, fields.status ?? "active", fields.retryCount ?? 0, fields.nextRetryAt ?? null);
}

function insertSkip(id: string, accountId: string) {
	sqlite.prepare(`INSERT INTO external_message_skips
		(id, account_id, remote_message_id, remote_folder_key, reason, created_at) VALUES (?, ?, ?, 'inbox', 'too_large', 1)`)
		.run(id, accountId, `remote_${id}`);
}

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE external_accounts (
			id text PRIMARY KEY, organization_id text, mailbox_id text, owner_user_id text, provider text,
			external_address text, status text, import_mode text, retain_original integer, last_sync_at integer,
			last_error_code text, error_retry_count integer NOT NULL DEFAULT 0, next_retry_at integer,
			created_at integer, updated_at integer, revoked_at integer
		);
		CREATE TABLE external_message_skips (
			id text PRIMARY KEY, account_id text NOT NULL, remote_message_id text NOT NULL,
			remote_folder_key text NOT NULL, reason text NOT NULL, created_at integer NOT NULL
		);
		CREATE TABLE mailboxes (id text PRIMARY KEY, local_part text, domain_id text);
		CREATE TABLE domains (id text PRIMARY KEY, hostname text);
		CREATE TABLE users (id text PRIMARY KEY, name text);
		INSERT INTO mailboxes VALUES ('mbx_1', 'support', 'dom_1');
		INSERT INTO domains VALUES ('dom_1', 'example.com');
		INSERT INTO users VALUES ('usr_1', 'Owner');
	`);
	h.db = drizzle(async (query, params, method) => {
		const statement = sqlite.prepare(query);
		if (method === "run") {
			statement.run(...(params as never[]));
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		return { rows: statement.all(...(params as never[])) as unknown as unknown[][] };
	});
});

afterEach(() => sqlite.close());

describe("external account list against real SQLite", () => {
	it("counts each account's own skipped messages and never another account's", async () => {
		insertAccount("exa_a");
		insertAccount("exa_b");
		insertAccount("exa_none");
		insertSkip("1", "exa_a");
		insertSkip("2", "exa_a");
		insertSkip("3", "exa_b");

		const rows = await listExternalAccounts({} as CloudflareEnv, "usr_1", "org_1");

		expect(Object.fromEntries(rows.map((row) => [row.id, row.skippedMessageCount])))
			.toEqual({ exa_a: 2, exa_b: 1, exa_none: 0 });
	});

	it("returns the retry due time as a date and flags a spent schedule", async () => {
		insertAccount("exa_waiting", { status: "error", retryCount: 2, nextRetryAt: 1_790_000_000 });
		insertAccount("exa_spent", { status: "error", retryCount: 5 });

		const rows = await listExternalAccounts({} as CloudflareEnv, "usr_1", "org_1");
		const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

		expect(byId.exa_waiting.nextRetryAt).toEqual(new Date(1_790_000_000 * 1000));
		expect(byId.exa_waiting.autoRetryExhausted).toBe(false);
		expect(byId.exa_spent.nextRetryAt).toBeNull();
		expect(byId.exa_spent.autoRetryExhausted).toBe(true);
	});
});
