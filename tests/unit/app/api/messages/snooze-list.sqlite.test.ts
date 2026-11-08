import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/messages/enrich", () => ({ enrichMessagesWithContacts: vi.fn(async (_e, _u, rows) => rows) }));

import { GET } from "@/app/api/messages/route";
import { POST as snooze } from "@/app/api/messages/[messageId]/snooze/route";

const NOW = new Date("2026-11-07T20:00:00Z");
const now = Math.floor(NOW.getTime() / 1000);
let sqlite: DatabaseSync;

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE mailbox_memberships (mailbox_id TEXT, user_id TEXT, role TEXT);
		CREATE TABLE mailboxes (id TEXT PRIMARY KEY, organization_id TEXT);
		CREATE TABLE messages (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT, mailbox_id TEXT, direction TEXT NOT NULL,
			provider_message_id TEXT, rfc_message_id TEXT, in_reply_to TEXT, references_header TEXT, reply_source_message_id TEXT,
			from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, subject TEXT, snippet TEXT, status TEXT NOT NULL,
			attachment_status TEXT NOT NULL, attachment_error TEXT, read INTEGER NOT NULL, starred INTEGER NOT NULL,
			thread_id TEXT, imap_uid INTEGER, received_at INTEGER, unsubscribe_url TEXT, unsubscribe_mailto TEXT,
			unsubscribe_one_click INTEGER NOT NULL DEFAULT 0, snoozed_until INTEGER, focus_override TEXT, expires_at INTEGER, created_at INTEGER NOT NULL
		);
		INSERT INTO mailboxes VALUES ('mbx_1', 'org1');
		INSERT INTO mailbox_memberships VALUES ('mbx_1', 'u1', 'manager');
	`);
	const insert = sqlite.prepare(`INSERT INTO messages (id, user_id, organization_id, mailbox_id, direction, from_addr, to_addr,
		status, attachment_status, read, starred, snoozed_until, created_at)
		VALUES (?, 'u1', 'org1', 'mbx_1', 'inbound', 'a@x.test', 'b@x.test', ?, 'none', 1, 0, ?, ?)`);
	insert.run("newest", "received", null, now - 60);
	insert.run("woken", "received", now - 30, now - 86400);
	insert.run("sleeping-soon", "received", now + 3600, now - 120);
	insert.run("sleeping-later", "received", now + 86400, now - 180);
	insert.run("archived-future", "archived", now + 3600, now - 240);
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

async function ids(query: string) {
	const res = await GET(new Request(`https://x.test/api/messages?${query}`));
	return ((await res.json()) as { data: { messages: Array<{ id: string }> } }).data.messages.map((row) => row.id);
}

function post(messageId: string, body: unknown) {
	return snooze(new Request(`https://x.test/api/messages/${messageId}/snooze`, {
		method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
	}), { params: Promise.resolve({ messageId }) });
}

describe("snoozed mail in the message list (F100)", () => {
	it("hides sleeping mail from the Inbox and shows woken mail first", async () => {
		expect(await ids("direction=inbound&status=received")).toEqual(["woken", "newest"]);
	});

	it("lists sleeping mail in the Snoozed view, soonest first", async () => {
		expect(await ids("direction=inbound&status=received&snoozed=true")).toEqual(["sleeping-soon", "sleeping-later"]);
	});

	it("does not hide or reorder non-Inbox mail by a snooze time", async () => {
		expect(await ids("status=archived")).toEqual(["archived-future"]);
	});
});

describe("POST /api/messages/[messageId]/snooze (F100)", () => {
	it("snoozes received mail, marking it unread so it returns as new", async () => {
		const res = await post("newest", { until: "2026-11-08T08:00:00.000Z" });
		expect(await res.json()).toEqual({ success: true, data: { snoozedUntil: "2026-11-08T08:00:00.000Z" } });
		expect(sqlite.prepare("SELECT snoozed_until, read FROM messages WHERE id = 'newest'").get())
			.toEqual({ snoozed_until: Math.floor(Date.parse("2026-11-08T08:00:00Z") / 1000), read: 0 });
		expect(await ids("direction=inbound&status=received")).toEqual(["woken"]);
	});

	it("wakes a message with null", async () => {
		await post("sleeping-soon", { until: null });
		expect(await ids("direction=inbound&status=received")).toContain("sleeping-soon");
	});

	it("rejects past, far-future, malformed, and non-Inbox requests", async () => {
		expect((await post("newest", { until: "2026-11-07T19:00:00Z" })).status).toBe(400);
		expect((await post("newest", { until: "2028-01-01T00:00:00Z" })).status).toBe(400);
		expect((await post("newest", { until: "tomorrow" })).status).toBe(400);
		expect((await post("newest", "nope")).status).toBe(400);
		expect((await post("archived-future", { until: null })).status).toBe(404);
	});

	it("denies another user's message (cross-tenant denial)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u2", organizationId: "org1" });
		expect((await post("newest", { until: "2026-11-08T08:00:00Z" })).status).toBe(404);
		m.getCurrentUser.mockResolvedValue(null);
		expect((await post("newest", { until: null })).status).toBe(401);
	});
});
