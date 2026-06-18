import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { GET } from "@/app/api/messages/counts/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
});

function get(qs = "") {
	return GET(new Request(`https://x.test/api/messages/counts${qs}`));
}

describe("GET /api/messages/counts", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(401);
	});

	it("returns counts with no mailbox filter, exercising every folder branch", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([
			// inbox (unread) + has mailbox
			{ mailboxId: "mb1", direction: "inbound", status: "received", read: false },
			// inbox (read)
			{ mailboxId: "mb1", direction: "inbound", status: "received", read: true },
			// sent
			{ mailboxId: "mb1", direction: "outbound", status: "sent", read: true },
			// drafts
			{ mailboxId: "mb2", direction: "outbound", status: "draft", read: false },
			// trash
			{ mailboxId: "mb2", direction: "inbound", status: "trash", read: false },
			// spam
			{ mailboxId: "mb2", direction: "inbound", status: "spam", read: true },
			// unmatched folder (null) AND no mailbox -> continue branch
			{ mailboxId: null, direction: "inbound", status: "archived", read: true },
		]);
		const res = await get();
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.counts.folders.inbox).toEqual({ total: 2, unread: 1 });
		expect(body.counts.folders.sent.total).toBe(1);
		expect(body.counts.folders.drafts.total).toBe(1);
		expect(body.counts.folders.trash.total).toBe(1);
		expect(body.counts.folders.spam.total).toBe(1);
		expect(body.counts.mailboxes).toHaveLength(2);
		const mb1 = body.counts.mailboxes.find((x: { mailboxId: string }) => x.mailboxId === "mb1");
		expect(mb1).toMatchObject({ total: 3, unread: 1, inbox: 2 });
	});

	it("applies the mailboxId filter", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([]);
		const res = await get("?mailboxId=mb1");
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			counts: { folders: expect.any(Object), mailboxes: [] },
		});
	});
});
