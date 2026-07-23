import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardOrgAdmin: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));

import { PATCH, DELETE } from "@/app/api/org/members/[id]/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
});

function patchReq(body?: unknown) {
	return new Request("https://x.test/api/org/members/mem1", {
		method: "PATCH",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}
const params = (id = "mem1") => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/org/members/[id]", () => {
	it("returns the guard error when not an admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await PATCH(patchReq({ role: "admin" }), params());
		expect(res.status).toBe(403);
	});

	it("returns 400 for an invalid role", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await PATCH(patchReq({ role: "superuser" }), params());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Invalid role" } });
	});

	it("returns 404 when the membership is missing", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]); // membership lookup
		const res = await PATCH(patchReq({ role: "admin" }), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Member not found" } });
	});

	it("returns 403 when targeting the owner", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "mem1", role: "owner" }]);
		const res = await PATCH(patchReq({ role: "admin" }), params());
		expect(res.status).toBe(403);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Cannot change the owner's role" } });
	});

	it("updates a member role", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "mem1", role: "member" }]); // membership
		mock.queueSelect([{ id: "mem1", role: "admin", email: "a@x.test" }]); // updated row
		const res = await PATCH(patchReq({ role: "admin" }), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { member: { id: "mem1", role: "admin", email: "a@x.test" } },
		});
		expect(mock.updates[0].set).toMatchObject({ role: "admin" });
	});
});

describe("DELETE /api/org/members/[id]", () => {
	function delReq() {
		return new Request("https://x.test/api/org/members/mem1", { method: "DELETE" });
	}

	it("returns the guard error when not an admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await DELETE(delReq(), params());
		expect(res.status).toBe(403);
	});

	it("returns 404 when the membership is missing", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await DELETE(delReq(), params());
		expect(res.status).toBe(404);
	});

	it("returns 403 when removing the owner", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "mem1", role: "owner", userId: "u1" }]);
		const res = await DELETE(delReq(), params());
		expect(res.status).toBe(403);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Cannot remove the owner" } });
	});

	it("removes the member and clears their organizationId", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "mem1", role: "member", userId: "u9" }]);
		const res = await DELETE(delReq(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { ok: true } });
		expect(mock.deletes).toHaveLength(2);
		expect(mock.updates[0].set).toMatchObject({ organizationId: null });
	});
});
