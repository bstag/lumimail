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
		expect((await res.json()) as any).toEqual({ error: "Unauthorized" });
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
		expect((await res.json()) as any).toEqual({ messages: [{ id: "m1" }] });
	});

	it("applies mailboxId and inbound direction filters and caps the limit", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", organizationId: "o1", scopes: ["read"] });
		m.requireScope.mockReturnValue(true);
		mock.queueSelect([]);
		const res = await GET(req("?mailboxId=mb1&direction=inbound&limit=500"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ messages: [] });
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
		expect(res.status).toBe(200);
	});
});
