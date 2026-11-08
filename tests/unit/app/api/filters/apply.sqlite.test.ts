import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, seedMessage } from "../../../helpers/sqlite";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { GET, POST } from "@/app/api/filters/[id]/apply/route";

let sqlite: DatabaseSync;

beforeEach(() => {
	const created = createMigratedDb();
	sqlite = created.sqlite;
	m.db = created.db;
	m.getCurrentUser.mockReset().mockResolvedValue({ id: "u1", organizationId: null });
	sqlite.exec(`
		INSERT INTO message_filters (id, user_id, name, from_contains, action_archive, created_at)
		VALUES ('f_mine', 'u1', 'Deals', 'shop.test', 1, 1), ('f_theirs', 'u2', 'Deals', 'shop.test', 1, 1);
	`);
	seedMessage(sqlite, { id: "mine", from_addr: "deals@shop.test" });
	seedMessage(sqlite, { id: "theirs", user_id: "u2", from_addr: "deals@shop.test" });
});

afterEach(() => sqlite.close());

const call = (handler: typeof GET, id: string) =>
	handler(new Request(`https://x.test/api/filters/${id}/apply`, { method: handler === GET ? "GET" : "POST" }), { params: Promise.resolve({ id }) });

const status = (id: string) => (sqlite.prepare("SELECT status FROM messages WHERE id = ?").get(id) as { status: string }).status;

describe("/api/filters/[id]/apply (F101)", () => {
	it("previews with GET and applies with POST to the user's own mail", async () => {
		const preview = await call(GET, "f_mine");
		expect(await preview.json()).toEqual({ success: true, data: { matched: 1 } });
		expect(status("mine")).toBe("received");

		const applied = await call(POST, "f_mine");
		expect(await applied.json()).toEqual({ success: true, data: { matched: 1 } });
		expect(status("mine")).toBe("archived");
		expect(status("theirs")).toBe("received");
	});

	it("denies another user's filter (cross-tenant denial)", async () => {
		expect((await call(POST, "f_theirs")).status).toBe(404);
		expect((await call(GET, "f_theirs")).status).toBe(404);
		expect(status("theirs")).toBe("received");
	});

	it("requires a session", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		expect((await call(POST, "f_mine")).status).toBe(401);
	});
});
