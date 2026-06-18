import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardOrgAdmin: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));

import { DELETE } from "@/app/api/aliases/[id]/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const params = (id = "a1") => ({ params: Promise.resolve({ id }) });
const req = () => new Request("https://x.test/api/aliases/a1", { method: "DELETE" });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
});

describe("DELETE /api/aliases/[id]", () => {
	it("returns the guard error response (403) for non-admins", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await DELETE(req(), params());
		expect(res.status).toBe(403);
	});

	it("returns 404 when the alias is not found / cross-tenant", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Alias not found" } });
	});

	it("deletes the alias on success", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "a1", organizationId: "o1" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { ok: true } });
		expect(mock.deletes).toHaveLength(1);
	});
});
