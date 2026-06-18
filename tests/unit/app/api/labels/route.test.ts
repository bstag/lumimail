import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/ids", () => ({ newId: () => "lbl_1" }));

import { GET, POST } from "@/app/api/labels/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

function post(body?: unknown, raw?: string) {
	return new Request("https://x.test/api/labels", {
		method: "POST",
		body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/labels", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(new Request("https://x.test/api/labels"));
		expect(res.status).toBe(401);
	});

	it("lists the user's labels", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "lbl_1", name: "Work" }]);
		const res = await GET(new Request("https://x.test/api/labels"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: [{ id: "lbl_1", name: "Work" }] });
	});
});

describe("POST /api/labels", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(post({ name: "Work" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for invalid JSON", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(post(undefined, "not json"));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Invalid JSON" } });
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(post({ name: "" }));
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).success).toBe(false);
	});

	it("creates a label with provided color and organizationId", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		mock.queueSelect([{ id: "lbl_1", name: "Work", color: "#abcdef" }]);
		const res = await POST(post({ name: "Work", color: "#abcdef" }));
		expect(res.status).toBe(201);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { id: "lbl_1", name: "Work", color: "#abcdef" },
		});
		expect(mock.inserts[0].values).toMatchObject({
			id: "lbl_1",
			userId: "u1",
			organizationId: "org1",
			name: "Work",
			color: "#abcdef",
		});
	});

	it("defaults color and null organizationId when omitted", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "lbl_1" }]);
		const res = await POST(post({ name: "Work" }));
		expect(res.status).toBe(201);
		expect(mock.inserts[0].values).toMatchObject({
			organizationId: null,
			color: "#6366f1",
		});
	});
});
