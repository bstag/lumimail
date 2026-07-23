import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	authenticateApiKey: vi.fn(),
	requireScope: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/api/auth", () => ({
	authenticateApiKey: m.authenticateApiKey,
	requireScope: m.requireScope,
}));

import { GET } from "@/app/api/v1/messages/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.authenticateApiKey.mockReset();
	m.requireScope.mockReset();
});

function req(qs = "", auth = "Bearer ep_key") {
	return new Request(`https://x.test/api/v1/messages${qs}`, {
		headers: auth ? { authorization: auth } : {},
	});
}

describe("GET /api/v1/messages", () => {
	it("returns 401 when authentication fails", async () => {
		m.authenticateApiKey.mockResolvedValue(null);
		const res = await GET(req());
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Unauthorized" },
		});
	});

	it("returns 401 when the read scope is missing", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: [] });
		m.requireScope.mockReturnValue(false);
		const res = await GET(req());
		expect(res.status).toBe(401);
	});

	it("lists messages with no filters (default limit 50)", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", organizationId: "o1", scopes: ["read"] });
		m.requireScope.mockReturnValue(true);
		mock.queueSelect([{ id: "m1" }]);
		const res = await GET(req());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { messages: [{ id: "m1" }], hasMore: false, uidNext: 1 },
		});
	});

	it("applies mailboxId and inbound direction filters and caps the limit", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", organizationId: "o1", scopes: ["read"] });
		m.requireScope.mockReturnValue(true);
		mock.queueSelect([]);
		const res = await GET(req("?mailboxId=mb1&direction=inbound&limit=500"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { messages: [], hasMore: false, uidNext: 1 },
		});
	});

	it("applies the outbound direction filter", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", organizationId: "o1", scopes: ["read"] });
		m.requireScope.mockReturnValue(true);
		mock.queueSelect([]);
		const res = await GET(req("?direction=outbound"));
		expect(res.status).toBe(200);
	});

	it("ignores unknown direction values", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", organizationId: "o1", scopes: ["read"] });
		m.requireScope.mockReturnValue(true);
		mock.queueSelect([]);
		const res = await GET(req("?direction=sideways"));
		expect(res.status).toBe(400);
	});

	it("applies status, starred, and offset filters", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", organizationId: "o1", scopes: ["read"] });
		m.requireScope.mockReturnValue(true);
		mock.queueSelect([{ id: "m1" }, { id: "m2" }]);

		const res = await GET(req("?mailboxId=mb1&status=trash&starred=true&offset=20&limit=1"));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: { messages: [{ id: "m1" }], hasMore: true, uidNext: 1 },
		});
	});

	it("returns a monotonic UIDNEXT from the persistent allocator", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", organizationId: "o1", scopes: ["read"] });
		m.requireScope.mockReturnValue(true);
		mock.queueSelect([{ id: "m1", imapUid: 5 }]).queueSelect([{ value: 80 }]);

		const res = await GET(req("?mailboxId=mb1"));

		expect(await res.json()).toMatchObject({
			data: { uidNext: 81 },
		});
	});

	it("rejects invalid pagination and filter values", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", organizationId: "o1", scopes: ["read"] });
		m.requireScope.mockReturnValue(true);

		for (const query of ["?limit=zero", "?limit=0", "?offset=-1", "?starred=yes", "?status=unknown"]) {
			const res = await GET(req(query));
			expect(res.status).toBe(400);
		}
	});
});
