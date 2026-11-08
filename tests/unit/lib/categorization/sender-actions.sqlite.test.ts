import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/ids", () => ({ newId: (prefix: string) => `${prefix}_new` }));

import { archiveSender, unsubscribeSender } from "@/lib/categorization/sender-actions";

let sqlite: DatabaseSync;
const env = {} as CloudflareEnv;
// Same organization, but the intruder has no membership in mbx_1.
const me = { id: "u1", organizationId: "org1" };
const intruder = { id: "u2", organizationId: "org1" };

const row = <T,>(query: string, ...params: unknown[]) => sqlite.prepare(query).get(...(params as never[])) as T;

function insertMessage(id: string, fields: {
	from?: string; status?: string; created?: number; url?: string | null; mailto?: string | null; oneClick?: number;
	direction?: string; mailbox?: string;
} = {}) {
	sqlite.prepare(`INSERT INTO messages (id, user_id, organization_id, mailbox_id, direction, from_addr, to_addr, status,
		created_at, unsubscribe_url, unsubscribe_mailto, unsubscribe_one_click)
		VALUES (?, 'u1', 'org1', ?, ?, ?, 'me@x.test', ?, ?, ?, ?, ?)`).run(
		id, fields.mailbox ?? "mbx_1", fields.direction ?? "inbound", fields.from ?? '"Shop" <Deals@Shop.example>',
		fields.status ?? "received", fields.created ?? 1, fields.url ?? null, fields.mailto ?? null, fields.oneClick ?? 0,
	);
}

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE mailbox_memberships (mailbox_id TEXT, user_id TEXT, role TEXT);
		CREATE TABLE mailboxes (id TEXT PRIMARY KEY, organization_id TEXT);
		CREATE TABLE messages (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT, mailbox_id TEXT, direction TEXT NOT NULL,
			from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
			unsubscribe_url TEXT, unsubscribe_mailto TEXT, unsubscribe_one_click INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE message_filters (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, from_contains TEXT, to_contains TEXT,
			subject_contains TEXT, has_words TEXT, action_star INTEGER NOT NULL DEFAULT 0,
			action_mark_read INTEGER NOT NULL DEFAULT 0, action_archive INTEGER NOT NULL DEFAULT 0, action_label_id TEXT,
			action_move_to_trash INTEGER NOT NULL DEFAULT 0, match_mode TEXT NOT NULL DEFAULT 'all', action_focus TEXT,
			action_expire_days INTEGER, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
		);
	`);
	sqlite.exec(`INSERT INTO mailboxes VALUES ('mbx_1', 'org1'), ('mbx_other', 'org1');
		INSERT INTO mailbox_memberships VALUES ('mbx_1', 'u1', 'manager'), ('mbx_other', 'u1', 'manager');`);
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

describe("unsubscribeSender (F98)", () => {
	it("POSTs the RFC 8058 one-click body to the newest target", async () => {
		insertMessage("old", { created: 1, url: "https://shop.example/old", oneClick: 1 });
		insertMessage("new", { created: 2, url: "https://shop.example/new", oneClick: 1 });
		const fetcher = vi.fn(async () => new Response("", { status: 200 }));

		expect(await unsubscribeSender(env, me, { sender: "deals@shop.example", mailboxId: null }, fetcher))
			.toEqual({ method: "one_click", ok: true });
		const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://shop.example/new");
		expect(init).toMatchObject({ method: "POST", body: "List-Unsubscribe=One-Click", credentials: "omit" });
	});

	it("reports a failed one-click request", async () => {
		insertMessage("m", { url: "https://shop.example/u", oneClick: 1 });
		expect(await unsubscribeSender(env, me, { sender: "deals@shop.example", mailboxId: null },
			async () => new Response("", { status: 500 }))).toEqual({ method: "one_click", ok: false });
		expect(await unsubscribeSender(env, me, { sender: "deals@shop.example", mailboxId: null },
			async () => { throw new Error("offline"); })).toEqual({ method: "one_click", ok: false });
	});

	it("returns a link or mailto target for the reader when one-click is not offered", async () => {
		insertMessage("m", { url: "https://shop.example/u" });
		const fetcher = vi.fn();
		expect(await unsubscribeSender(env, me, { sender: "deals@shop.example", mailboxId: null }, fetcher))
			.toEqual({ method: "link", url: "https://shop.example/u" });
		sqlite.exec("DELETE FROM messages");
		insertMessage("m", { mailto: "mailto:leave@shop.example" });
		expect(await unsubscribeSender(env, me, { sender: "deals@shop.example", mailboxId: null }, fetcher))
			.toEqual({ method: "mailto", url: "mailto:leave@shop.example" });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("finds nothing for another user's mail (cross-tenant denial) or a sender without targets", async () => {
		insertMessage("m", { url: "https://shop.example/u", oneClick: 1 });
		const fetcher = vi.fn();
		expect(await unsubscribeSender(env, intruder, { sender: "deals@shop.example", mailboxId: null }, fetcher))
			.toEqual({ method: "none" });
		expect(await unsubscribeSender(env, me, { sender: "other@x.test", mailboxId: null }, fetcher))
			.toEqual({ method: "none" });
		expect(await unsubscribeSender(env, me, { sender: "deals@shop.example", mailboxId: "mbx_other" }, fetcher))
			.toEqual({ method: "none" });
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe("archiveSender (F98)", () => {
	it("archives only the sender's received inbound mail and adds one auto-archive filter", async () => {
		insertMessage("a");
		insertMessage("b", { from: "deals@shop.example" });
		insertMessage("starred-archived", { status: "archived" });
		insertMessage("other", { from: "friend@x.test" });
		insertMessage("sent", { direction: "outbound" });

		expect(await archiveSender(env, me, { sender: "DEALS@shop.example", mailboxId: null, createFilter: true }))
			.toEqual({ archived: 2, filterId: "filter_new" });
		expect(row<{ n: number }>("SELECT count(*) n FROM messages WHERE status = 'archived'").n).toBe(3);
		expect(row<{ status: string }>("SELECT status FROM messages WHERE id = 'other'").status).toBe("received");
		expect(row<{ status: string }>("SELECT status FROM messages WHERE id = 'sent'").status).toBe("received");
		expect(row<{ from_contains: string; action_archive: number; name: string }>(
			"SELECT from_contains, action_archive, name FROM message_filters",
		)).toEqual({ from_contains: "deals@shop.example", action_archive: 1, name: "Auto-archive deals@shop.example" });

		insertMessage("c");
		expect(await archiveSender(env, me, { sender: "deals@shop.example", mailboxId: null, createFilter: true }))
			.toEqual({ archived: 1, filterId: "filter_new" });
		expect(row<{ n: number }>("SELECT count(*) n FROM message_filters").n).toBe(1);
	});

	it("can archive without a filter and never touches another user's mail", async () => {
		insertMessage("a");
		expect(await archiveSender(env, intruder, { sender: "deals@shop.example", mailboxId: null, createFilter: false }))
			.toEqual({ archived: 0, filterId: null });
		expect(await archiveSender(env, me, { sender: "deals@shop.example", mailboxId: null, createFilter: false }))
			.toEqual({ archived: 1, filterId: null });
		expect(row<{ n: number }>("SELECT count(*) n FROM message_filters").n).toBe(0);
	});
});
