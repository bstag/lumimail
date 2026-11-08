import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, seedMessage } from "../../../helpers/sqlite";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { POST } from "@/app/api/messages/bulk/route";

const DAY = 86_400;
let sqlite: DatabaseSync;
let now: number;

beforeEach(() => {
	const created = createMigratedDb();
	sqlite = created.sqlite;
	m.db = created.db;
	m.getCurrentUser.mockReset().mockResolvedValue({ id: "u1", organizationId: null });
	now = Math.floor(Date.now() / 1000);
	sqlite.exec("INSERT INTO labels (id, user_id, name, color, created_at) VALUES ('promo', 'u1', 'Promotions', '#000000', 1)");
	seedMessage(sqlite, { id: "old-promo", created_at: now - 40 * DAY });
	seedMessage(sqlite, { id: "new-promo", created_at: now - 2 * DAY });
	seedMessage(sqlite, { id: "old-personal", created_at: now - 40 * DAY });
	seedMessage(sqlite, { id: "old-snoozed", created_at: now - 40 * DAY, snoozed_until: now + DAY });
	seedMessage(sqlite, { id: "old-theirs", user_id: "u2", created_at: now - 40 * DAY });
	seedMessage(sqlite, { id: "old-archived", status: "archived", created_at: now - 40 * DAY });
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('old-promo', 'promo'), ('new-promo', 'promo')");
});

afterEach(() => sqlite.close());

async function bulk(body: unknown) {
	const res = await POST(new Request("https://x.test/api/messages/bulk", { method: "POST", body: JSON.stringify(body) }));
	return { status: res.status, body: await res.json() as { data?: Record<string, unknown> } };
}

const statusOf = (id: string) => (sqlite.prepare("SELECT status FROM messages WHERE id = ?").get(id) as { status: string }).status;
const inbox = { direction: "inbound", status: "received" };

describe("POST /api/messages/bulk with a view query (F102)", () => {
	it("previews and archives Inbox mail older than N days, skipping snoozed mail", async () => {
		const preview = await bulk({ action: "archive", preview: true, query: { ...inbox, olderThanDays: "30" } });
		expect(preview.body.data).toEqual({ matched: 2 });
		expect(statusOf("old-promo")).toBe("received");

		const applied = await bulk({ action: "archive", query: { ...inbox, olderThanDays: "30" } });
		expect(applied.body.data).toEqual({ ok: true, updated: 2 });
		expect(["old-promo", "old-personal"].map(statusOf)).toEqual(["archived", "archived"]);
		expect(["new-promo", "old-snoozed"].map(statusOf)).toEqual(["received", "received"]);
	});

	it("scopes to the Other tab and never touches another user's mail (cross-tenant denial)", async () => {
		const applied = await bulk({ action: "read", query: { ...inbox, focus: "other" } });
		expect(applied.body.data).toEqual({ ok: true, updated: 2 });
		const read = (id: string) => (sqlite.prepare("SELECT read FROM messages WHERE id = ?").get(id) as { read: number }).read;
		expect(["old-promo", "new-promo", "old-personal", "old-theirs"].map(read)).toEqual([1, 1, 0, 0]);
		expect(statusOf("old-theirs")).toBe("received");
	});

	it("reports zero without writing when nothing matches", async () => {
		const applied = await bulk({ action: "trash", query: { ...inbox, q: "nothing-matches" } });
		expect(applied.body.data).toEqual({ ok: true, updated: 0 });
	});

	it("rejects invalid view queries and empty requests", async () => {
		expect((await bulk({ action: "archive", query: { olderThanDays: "0" } })).status).toBe(400);
		expect((await bulk({ action: "archive", query: { olderThanDays: "" } })).status).toBe(400);
		expect((await bulk({ action: "archive", query: { status: "bogus" } })).status).toBe(400);
		expect((await bulk({ action: "archive", query: { focus: "bulk" } })).status).toBe(400);
		expect((await bulk({ action: "explode", query: inbox })).status).toBe(400);
		expect((await bulk({ action: "archive" })).status).toBe(400);
	});
});
