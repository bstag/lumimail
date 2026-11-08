import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { GET } from "@/app/api/messages/digest/route";

const NOW = new Date("2026-11-07T20:00:00Z");
const now = Math.floor(NOW.getTime() / 1000);
let sqlite: DatabaseSync;

function insert(id: string, from: string, fields: { tag?: string; read?: number; age?: number; user?: string; mailbox?: string } = {}) {
	sqlite.prepare(`INSERT INTO messages (id, user_id, organization_id, mailbox_id, direction, from_addr, to_addr, subject, status,
		attachment_status, read, starred, created_at) VALUES (?, ?, 'org1', ?, 'inbound', ?, 'me@x.test', ?, 'received', 'none', ?, 0, ?)`)
		.run(id, fields.user ?? "u1", fields.mailbox ?? "mbx_1", from, `Subject ${id}`, fields.read ?? 0, now - (fields.age ?? 60));
	if (fields.tag !== undefined) sqlite.prepare("INSERT INTO message_labels VALUES (?, ?)").run(id, fields.tag);
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE mailbox_memberships (mailbox_id TEXT, user_id TEXT, role TEXT);
		CREATE TABLE mailboxes (id TEXT PRIMARY KEY, organization_id TEXT);
		CREATE TABLE labels (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL);
		CREATE TABLE message_labels (message_id TEXT NOT NULL, label_id TEXT NOT NULL);
		CREATE TABLE messages (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT, mailbox_id TEXT, direction TEXT NOT NULL,
			from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, subject TEXT, status TEXT NOT NULL, attachment_status TEXT NOT NULL,
			read INTEGER NOT NULL, starred INTEGER NOT NULL, received_at INTEGER, focus_override TEXT, created_at INTEGER NOT NULL
		);
		INSERT INTO mailboxes VALUES ('mbx_1', 'org1'), ('mbx_2', 'org1');
		INSERT INTO mailbox_memberships VALUES ('mbx_1', 'u1', 'manager'), ('mbx_2', 'u1', 'manager');
		INSERT INTO labels VALUES ('promo', 'u1', 'Promotions'), ('news', 'u1', 'Newsletters');
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
});

afterEach(() => {
	vi.useRealTimers();
	sqlite.close();
});

async function digest(query = "") {
	const res = await GET(new Request(`https://x.test/api/messages/digest${query}`));
	return { status: res.status, body: (await res.json()) as { data: Record<string, unknown> } };
}

describe("GET /api/messages/digest (F99)", () => {
	it("groups the last 24 hours of Other mail by sender with unread IDs", async () => {
		insert("d1", '"Deals" <deals@shop.test>', { tag: "promo", age: 300 });
		insert("d2", "deals@shop.test", { tag: "promo", age: 100, read: 1 });
		insert("n1", "news@paper.test", { tag: "news" });
		insert("old", "deals@shop.test", { tag: "promo", age: 2 * 86400 });
		insert("person", "friend@x.test");
		insert("other-mailbox", "deals@shop.test", { tag: "promo", mailbox: "mbx_2" });

		const { status, body } = await digest("?mailboxId=mbx_1");
		expect(status).toBe(200);
		expect(body.data).toEqual({
			total: 3,
			senderCount: 2,
			senders: [
				{ sender: "deals@shop.test", fromAddr: "deals@shop.test", count: 2, unread: 1, latestId: "d2", latestSubject: "Subject d2" },
				{ sender: "news@paper.test", fromAddr: "news@paper.test", count: 1, unread: 1, latestId: "n1", latestSubject: "Subject n1" },
			],
			unreadIds: expect.arrayContaining(["d1", "n1"]),
		});
		expect((body.data.unreadIds as string[])).toHaveLength(2);
		expect(((await digest()).body.data.total)).toBe(4);
	});

	it("shows nothing from mailboxes the user cannot read (cross-tenant denial)", async () => {
		insert("d1", "deals@shop.test", { tag: "promo" });
		m.getCurrentUser.mockResolvedValue({ id: "u2", organizationId: "org1" });
		expect((await digest()).body.data).toEqual({ total: 0, senderCount: 0, senders: [], unreadIds: [] });
	});
});
