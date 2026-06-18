import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardOrgAdmin: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));

import { GET, PATCH } from "@/app/api/org/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
});

function patchReq(body?: unknown) {
	return new Request("https://x.test/api/org", {
		method: "PATCH",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/org", () => {
	it("returns the guard error when not an admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await GET(new Request("https://x.test/api/org"));
		expect(res.status).toBe(403);
	});

	it("returns 404 when the org is missing", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await GET(new Request("https://x.test/api/org"));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Organization not found" } });
	});

	it("returns the organization", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "o1", name: "Acme" }]);
		const res = await GET(new Request("https://x.test/api/org"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { organization: { id: "o1", name: "Acme" } } });
	});
});

describe("PATCH /api/org", () => {
	it("returns the guard error when not an admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await PATCH(patchReq({ name: "Acme" }));
		expect(res.status).toBe(403);
	});

	it("returns 400 when name is missing", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await PATCH(patchReq({}));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Name is required" } });
	});

	it("returns 400 when name is whitespace only", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await PATCH(patchReq({ name: "   " }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when name is not a string", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await PATCH(patchReq({ name: 123 }));
		expect(res.status).toBe(400);
	});

	it("updates the organization name", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "o1", name: "New Name" }]);
		const res = await PATCH(patchReq({ name: "  New Name  " }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { organization: { id: "o1", name: "New Name" } } });
		expect(mock.updates[0].set).toMatchObject({ name: "New Name" });
	});
});
