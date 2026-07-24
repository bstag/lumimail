import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	getCurrentUser: vi.fn(),
	getContactDisplayNameMap: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/contacts/service", () => ({
	getContactDisplayNameMap: m.getContactDisplayNameMap,
}));
vi.mock("@/lib/email/address", () => ({
	normalizeEmailAddress: (addr: string) => (addr ?? "").toLowerCase(),
}));
vi.mock("@/lib/email/reply-content-utils", () => ({
	getLatestEmailContent: (s: string) => `latest:${s}`,
}));

import { GET } from "@/app/api/messages/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
	m.getContactDisplayNameMap.mockReset();
	m.getContactDisplayNameMap.mockResolvedValue(new Map());
});

function get(qs = "") {
	return GET(new Request(`https://x.test/api/messages${qs}`));
}

describe("GET /api/messages", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({ error: "Unauthorized" });
	});

	it("lists messages with no filters and enriches rows", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.getContactDisplayNameMap.mockResolvedValue(
			new Map([
				["from@x.test", "From Name"],
				["to@x.test", "To Name"],
			]),
		);
		mock.queueSelect([{ total: 1 }]); // count
		mock.queueSelect([
			{
				id: "m1",
				snippet: "body",
				fromAddr: "From@x.test",
				toAddr: "To@x.test",
			},
		]); // rows
		const res = await get();
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.total).toBe(1);
		expect(body.limit).toBe(50);
		expect(body.offset).toBe(0);
		expect(body.messages[0]).toMatchObject({
			id: "m1",
			snippet: "latest:body",
			fromContactName: "From Name",
			toContactName: "To Name",
		});
	});

	it("falls back to null contact names and total 0 when count row missing", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([]); // count -> undefined totalRow
		mock.queueSelect([{ id: "m1", snippet: "s", fromAddr: "a@x", toAddr: "b@x" }]);
		const res = await get();
		const body = (await res.json()) as any;
		expect(body.total).toBe(0);
		expect(body.messages[0].fromContactName).toBeNull();
		expect(body.messages[0].toContactName).toBeNull();
	});

	it("applies inbound/outbound, mailbox, status, read, starred and title filters", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get(
			"?direction=inbound&mailboxId=mb1&status=received&read=read&starred=true&title=Hello&limit=200&offset=-5",
		);
		const body = (await res.json()) as any;
		// limit capped at 100, offset clamped to >= 0
		expect(body.limit).toBe(100);
		expect(body.offset).toBe(0);
		expect(body.messages).toEqual([]);
	});

	it("applies outbound direction and unread filter", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get("?direction=outbound&read=unread");
		expect(res.status).toBe(200);
	});

	it("accepts a comma-delimited delivery-status filter", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get("?direction=outbound&status=queued,sent,failed");
		expect(res.status).toBe(200);
	});

	it("rejects an unknown message status", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await get("?status=teleported");
		expect(res.status).toBe(400);
	});

	it("ignores unknown direction values", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get("?direction=sideways");
		expect(res.status).toBe(200);
	});

	it("applies the q text-search filter", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get("?q=hello");
		expect(res.status).toBe(200);
	});

	it("filters by labelId and returns matching messages", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ messageId: "m1" }, { messageId: "m2" }]); // label lookup
		mock.queueSelect([{ total: 1 }]); // count
		mock.queueSelect([{ id: "m1", snippet: "s", fromAddr: "a@x", toAddr: "b@x" }]); // rows
		const res = await get("?labelId=lbl1");
		const body = (await res.json()) as any;
		expect(body.messages).toHaveLength(1);
	});

	it("short-circuits to an empty result when labelId has no messages", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([]); // label lookup -> no ids
		const res = await get("?labelId=lbl1&limit=10&offset=2");
		const body = (await res.json()) as any;
		expect(body).toEqual({ messages: [], total: 0, limit: 10, offset: 2 });
	});
});
