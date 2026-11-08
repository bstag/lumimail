import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, seedMessage } from "../../../helpers/sqlite";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/messages/enrich", () => ({ enrichMessagesWithContacts: vi.fn(async (_env, _userId, rows) => rows) }));

import { GET } from "@/app/api/messages/senders/route";
import { GET as LIST } from "@/app/api/messages/route";

let sqlite: DatabaseSync;

beforeEach(() => {
	const created = createMigratedDb();
	sqlite = created.sqlite;
	m.db = created.db;
	m.getCurrentUser.mockReset().mockResolvedValue({ id: "u1", organizationId: null });
	seedMessage(sqlite, { id: "s1", from_addr: "Shop <Deals@Shop.test>", subject: "Old deal", read: 1, created_at: 100 });
	seedMessage(sqlite, { id: "s2", from_addr: "deals@shop.test", subject: "New deal", created_at: 300 });
	seedMessage(sqlite, { id: "p1", from_addr: "Paper <news@paper.test>", subject: "Brief", created_at: 200 });
	seedMessage(sqlite, { id: "snoozed", from_addr: "late@x.test", created_at: 400, snoozed_until: Math.floor(Date.now() / 1000) + 3600 });
	seedMessage(sqlite, { id: "theirs", user_id: "u2", from_addr: "deals@shop.test", created_at: 500 });
});

afterEach(() => sqlite.close());

async function senders(query = "") {
	const res = await GET(new Request(`https://x.test/api/messages/senders?direction=inbound&status=received${query}`));
	return { status: res.status, body: await res.json() as { data?: { total: number; senders: Array<Record<string, unknown>> } } };
}

describe("GET /api/messages/senders (F103)", () => {
	it("groups the view by sender address, newest first, with counts and the latest message", async () => {
		const { body } = await senders();
		expect(body.data?.total).toBe(2);
		expect(body.data?.senders).toEqual([
			{ sender: "deals@shop.test", fromAddr: "deals@shop.test", count: 2, unread: 1, latestId: "s2", latestSubject: "New deal", latestAt: new Date(300_000).toISOString() },
			{ sender: "news@paper.test", fromAddr: "Paper <news@paper.test>", count: 1, unread: 1, latestId: "p1", latestSubject: "Brief", latestAt: new Date(200_000).toISOString() },
		]);
	});

	it("pages, hides snoozed and other users' mail (cross-tenant denial), and validates input", async () => {
		const { body } = await senders("&limit=1&offset=1");
		expect(body.data?.senders.map((row) => row.sender)).toEqual(["news@paper.test"]);
		expect((await senders("&limit=0")).status).toBe(400);
		expect((await senders("&offset=-1")).status).toBe(400);
		expect((await senders("&focus=bulk")).status).toBe(400);
	});

	it("lets the list narrow to one sender for an expanded group", async () => {
		const res = await LIST(new Request("https://x.test/api/messages?direction=inbound&status=received&sender=DEALS@shop.test"));
		const body = await res.json() as { data: { messages: Array<{ id: string }> } };
		expect(body.data.messages.map((row) => row.id)).toEqual(["s2", "s1"]);
	});

	it("rejects an invalid age on the list (F102)", async () => {
		const res = await LIST(new Request("https://x.test/api/messages?olderThanDays=0"));
		expect(res.status).toBe(400);
	});
});
