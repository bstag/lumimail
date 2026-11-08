import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/messages/enrich", () => ({
	enrichMessagesWithContacts: vi.fn(async (_env, _userId, rows) => rows),
}));

import { GET } from "@/app/api/messages/route";

let sqlite: DatabaseSync;

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE mailbox_memberships (mailbox_id TEXT, user_id TEXT, role TEXT);
		CREATE TABLE mailboxes (id TEXT PRIMARY KEY, organization_id TEXT);
		CREATE TABLE labels (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL);
		CREATE TABLE message_labels (message_id TEXT NOT NULL, label_id TEXT NOT NULL);
		CREATE TABLE messages (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT, mailbox_id TEXT,
			direction TEXT NOT NULL, provider_message_id TEXT, rfc_message_id TEXT, in_reply_to TEXT,
			references_header TEXT, reply_source_message_id TEXT, from_addr TEXT NOT NULL, to_addr TEXT NOT NULL,
			subject TEXT, snippet TEXT, status TEXT NOT NULL, attachment_status TEXT NOT NULL, attachment_error TEXT,
			read INTEGER NOT NULL, starred INTEGER NOT NULL, thread_id TEXT, imap_uid INTEGER, received_at INTEGER,
			unsubscribe_url TEXT, unsubscribe_mailto TEXT, unsubscribe_one_click INTEGER NOT NULL DEFAULT 0, snoozed_until INTEGER, focus_override TEXT, expires_at INTEGER,
			created_at INTEGER NOT NULL
		);
	`);
	m.db = drizzle(async (query, params, method) => {
		const statement = sqlite.prepare(query);
		if (method === "run") {
			statement.run(...(params as never[]));
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		return { rows: statement.all(...(params as never[])) as unknown as unknown[][] };
	});
	m.getCurrentUser.mockReset().mockResolvedValue({ id: "u1", organizationId: "org1" });

	const label = sqlite.prepare("INSERT INTO labels (id, user_id, name) VALUES (?, ?, ?)");
	label.run("promo", "u1", "Promotions");
	label.run("news", "u1", "NEWSLETTERS");
	label.run("reply", "u1", "Needs reply");
	label.run("receipts", "u1", "Receipts");
	label.run("foreign", "u2", "Promotions");
	const message = sqlite.prepare(`INSERT INTO messages (id, user_id, direction, from_addr, to_addr, status,
		attachment_status, read, starred, created_at) VALUES (?, 'u1', 'inbound', 'a@x.test', 'b@x.test', 'received', 'none', 0, ?, ?)`);
	const tag = sqlite.prepare("INSERT INTO message_labels (message_id, label_id) VALUES (?, ?)");
	const seed: Array<[string, string[], number]> = [
		["untagged", [], 0],
		["promo", ["promo"], 0],
		["news", ["news"], 0],
		["promo-reply", ["promo", "reply"], 0],
		["promo-starred", ["promo"], 1],
		["receipt", ["receipts"], 0],
		["foreign-promo", ["foreign"], 0],
	];
	seed.forEach(([id, tags, starred], index) => {
		message.run(id, starred, index);
		for (const t of tags) tag.run(id, t);
	});
	// Bulk-tagged mail from someone this user has written to stays Focused.
	sqlite.prepare(`INSERT INTO messages (id, user_id, direction, from_addr, to_addr, status, attachment_status, read, starred, created_at)
		VALUES ('promo-friend', 'u1', 'inbound', '"Ada" <ADA@Friend.test>', 'b@x.test', 'received', 'none', 0, 0, 50)`).run();
	tag.run("promo-friend", "promo");
	sqlite.prepare(`INSERT INTO messages (id, user_id, direction, from_addr, to_addr, status, attachment_status, read, starred, created_at)
		VALUES ('sent-1', 'u1', 'outbound', 'b@x.test', 'Ada <ada@friend.test>', 'sent', 'none', 1, 0, 51),
		('sent-list', 'u1', 'outbound', 'b@x.test', 'promo-list@x.test, a@x.test', 'sent', 'none', 1, 0, 52)`).run();
});

afterEach(() => sqlite.close());

async function list(focus?: string) {
	const query = focus === undefined ? "" : `&focus=${focus}`;
	const res = await GET(new Request(`https://x.test/api/messages?direction=inbound${query}`));
	const body = await res.json() as { data?: { messages: Array<{ id: string }>; total: number } };
	return { status: res.status, ids: (body.data?.messages ?? []).map((row) => row.id).sort() };
}

describe("GET /api/messages focus filter (F97)", () => {
	it("partitions received mail into Other (bulk only) and Focused (everything else)", async () => {
		expect((await list("other")).ids).toEqual(["news", "promo"]);
		expect((await list("focused")).ids).toEqual(
			["foreign-promo", "promo-friend", "promo-reply", "promo-starred", "receipt", "untagged"],
		);
		expect((await list()).ids).toHaveLength(8);
	});

	it("lets a filter's Show in Focused/Other override the computed split (F101)", async () => {
		sqlite.prepare("UPDATE messages SET focus_override = 'other' WHERE id = 'untagged'").run();
		sqlite.prepare("UPDATE messages SET focus_override = 'focused' WHERE id = 'promo'").run();

		expect((await list("other")).ids).toEqual(["news", "untagged"]);
		expect((await list("focused")).ids).toContain("promo");
	});

	it("rejects an unknown focus value", async () => {
		expect((await list("bulk")).status).toBe(400);
		expect((await list("")).ids).toHaveLength(8);
	});
});
