import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/ids", () => ({ newId: (p: string) => `${p}_1` }));

import { GET, PUT } from "@/app/api/vacation/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

function putReq(body?: unknown) {
	return new Request("https://x.test/api/vacation", {
		method: "PUT",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/vacation", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(new Request("https://x.test/api/vacation"));
		expect(res.status).toBe(401);
	});

	it("returns the existing responder", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "vac1", enabled: true }]);
		const res = await GET(new Request("https://x.test/api/vacation"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { responder: { id: "vac1", enabled: true } } });
	});

	it("returns null when no responder exists", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]);
		const res = await GET(new Request("https://x.test/api/vacation"));
		expect((await res.json()) as any).toEqual({ success: true, data: { responder: null } });
	});
});

describe("PUT /api/vacation", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await PUT(putReq({ enabled: true }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await PUT(putReq({ enabled: "yes" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Validation failed" } });
	});

	it("updates an existing responder using provided values and dates", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "vac1" }]); // existing
		const res = await PUT(
			putReq({
				enabled: true,
				subject: "Away",
				body: "Back soon",
				startDate: "2026-01-01T00:00:00.000Z",
				endDate: "2026-01-10T00:00:00.000Z",
			}),
		);
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { ok: true } });
		expect(mock.updates[0].set).toMatchObject({ enabled: true, subject: "Away", body: "Back soon" });
		expect((mock.updates[0].set as any).startDate).toBeInstanceOf(Date);
		expect((mock.updates[0].set as any).endDate).toBeInstanceOf(Date);
		expect(mock.inserts).toHaveLength(0);
	});

	it("inserts a new responder with default subject/body and null dates", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]); // no existing
		const res = await PUT(putReq({ enabled: false }));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			id: "vac_1",
			userId: "u1",
			enabled: false,
			subject: "Out of office",
			body: "I am currently out of office and will reply when I return.",
			startDate: null,
			endDate: null,
		});
	});
});
