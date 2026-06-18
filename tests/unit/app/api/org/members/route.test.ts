import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardOrgAdmin: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/ids", () => ({ newId: (p: string) => `${p}_1` }));

import { GET, POST } from "@/app/api/org/members/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
});

function postReq(body?: unknown) {
	return new Request("https://x.test/api/org/members", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/org/members", () => {
	it("returns the guard error when not an admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await GET(new Request("https://x.test/api/org/members"));
		expect(res.status).toBe(403);
	});

	it("returns members and pending invites", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "mem1", email: "a@x.test", role: "member" }]); // members
		mock.queueSelect([{ id: "inv1", email: "b@x.test", token: "tok" }]); // invites
		const res = await GET(new Request("https://x.test/api/org/members"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: {
				members: [{ id: "mem1", email: "a@x.test", role: "member" }],
				invites: [{ id: "inv1", email: "b@x.test", token: "tok" }],
			},
		});
	});
});

describe("POST /api/org/members", () => {
	it("returns the guard error when not an admin", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await POST(postReq({ email: "a@x.test" }));
		expect(res.status).toBe(403);
	});

	it("returns 400 when email is missing", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await POST(postReq({ email: "  " }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Email is required" } });
	});

	it("returns 400 when email is not a string", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await POST(postReq({ email: 5, role: "admin" }));
		expect(res.status).toBe(400);
	});

	it("returns 409 when the email is already a member", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "mem1" }]); // existing member
		const res = await POST(postReq({ email: "A@X.test" }));
		expect(res.status).toBe(409);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Already a member" } });
	});

	it("refreshes an existing invite (default role member)", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]); // no member
		mock.queueSelect([{ id: "inv1" }]); // existing invite
		const res = await POST(postReq({ email: "b@x.test" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { invite: { id: "inv1", token: "tok_1" } } });
		expect(mock.updates[0].set).toMatchObject({ role: "member", token: "tok_1" });
		expect(mock.inserts).toHaveLength(0);
	});

	it("creates a new invite with an admin role", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]); // no member
		mock.queueSelect([]); // no existing invite
		const res = await POST(postReq({ email: "c@x.test", role: "admin" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { invite: { id: "inv_1", token: "tok_1" } } });
		expect(mock.inserts[0].values).toMatchObject({
			id: "inv_1",
			organizationId: "o1",
			email: "c@x.test",
			role: "admin",
			token: "tok_1",
		});
	});

	it("defaults an unknown role to member", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		mock.queueSelect([]);
		const res = await POST(postReq({ email: "d@x.test", role: "superuser" }));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({ role: "member" });
	});
});
