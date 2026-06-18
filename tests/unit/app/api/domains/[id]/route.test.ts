import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	getDomainForUser: vi.fn(),
	removeDomainForUser: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/domains/service", () => ({
	getDomainForUser: m.getDomainForUser,
	removeDomainForUser: m.removeDomainForUser,
}));

import { GET, PATCH, DELETE } from "@/app/api/domains/[id]/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const params = (id = "d1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.getDomainForUser.mockReset();
	m.removeDomainForUser.mockReset();
});

function req(body?: unknown) {
	return new Request("https://x.test/api/domains/d1", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/domains/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 with no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await GET(req(), params());
		expect(res.status).toBe(400);
	});

	it("returns 404 when the domain is not found / cross-tenant", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.getDomainForUser.mockResolvedValue(undefined);
		const res = await GET(req(), params());
		expect(res.status).toBe(404);
		expect(m.getDomainForUser).toHaveBeenCalledWith({}, "o1", "d1");
	});

	it("returns the domain on success", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.getDomainForUser.mockResolvedValue({ id: "d1" });
		const res = await GET(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { domain: { id: "d1" } } });
	});
});

describe("PATCH /api/domains/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await PATCH(req({ routingEnabled: true }), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 with no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await PATCH(req({ routingEnabled: true }), params());
		expect(res.status).toBe(400);
	});

	it("returns 404 when the domain is not found", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.getDomainForUser.mockResolvedValue(undefined);
		const res = await PATCH(req({ routingEnabled: true }), params());
		expect(res.status).toBe(404);
	});

	it("returns 400 when no valid fields are supplied", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.getDomainForUser.mockResolvedValue({ id: "d1" });
		const res = await PATCH(req({ routingEnabled: "yes", other: 1 }), params());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "No valid fields to update" } });
	});

	it("updates both boolean fields and returns the updated row", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.getDomainForUser.mockResolvedValue({ id: "d1" });
		mock.queueSelect([{ id: "d1", routingEnabled: true, sendingEnabled: false }]);
		const res = await PATCH(req({ routingEnabled: true, sendingEnabled: false }), params());
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toEqual({ routingEnabled: true, sendingEnabled: false });
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { domain: { id: "d1", routingEnabled: true, sendingEnabled: false } },
		});
	});
});

describe("DELETE /api/domains/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await DELETE(req(), params());
		expect(res.status).toBe(401);
	});

	it("removes the domain on success", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.removeDomainForUser.mockResolvedValue(undefined);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { ok: true } });
		expect(m.removeDomainForUser).toHaveBeenCalledWith({}, "o1", "d1");
	});

	it("returns 400 when removal throws", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.removeDomainForUser.mockRejectedValue(new Error("boom"));
		const res = await DELETE(req(), params());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Failed to remove domain" } });
	});
});
