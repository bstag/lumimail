import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));

import { PATCH, DELETE } from "@/app/api/webhooks/[id]/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const params = (id = "wh_1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

function req(body?: unknown) {
	return new Request("https://x.test/api/webhooks/wh_1", {
		method: "PATCH",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("DELETE /api/webhooks/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await DELETE(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 404 when webhook not found / cross-tenant", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Webhook not found" } });
	});

	it("deletes an existing webhook", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "wh_1", userId: "u1" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { ok: true } });
		expect(mock.deletes.length).toBe(1);
	});
});

describe("PATCH /api/webhooks/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await PATCH(req({ enabled: true }), params());
		expect(res.status).toBe(401);
	});

	it("returns 404 when webhook not found / cross-tenant", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]);
		const res = await PATCH(req({ enabled: true }), params());
		expect(res.status).toBe(404);
	});

	it("updates the enabled flag when boolean", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "wh_1", userId: "u1" }]);
		const res = await PATCH(req({ enabled: false }), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { ok: true } });
		expect(mock.updates[0].set).toEqual({ enabled: false });
	});

	it("does not update when enabled is not a boolean", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "wh_1", userId: "u1" }]);
		const res = await PATCH(req({}), params());
		expect(res.status).toBe(200);
		expect(mock.updates.length).toBe(0);
	});
});
