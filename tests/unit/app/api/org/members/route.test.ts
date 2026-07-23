import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardOrgAdmin: vi.fn(),
	hashInvitationToken: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/ids", () => ({ newId: (p: string) => `${p}_1` }));
vi.mock("@/lib/auth/invitation", () => ({ hashInvitationToken: m.hashInvitationToken }));

import { GET, POST } from "@/app/api/org/members/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
	m.hashInvitationToken.mockReset().mockResolvedValue("hashed_tok_1");
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
		mock.queueSelect([{ id: "inv1", email: "b@x.test", role: "member" }]); // invites
		const res = await GET(new Request("https://x.test/api/org/members"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: {
				members: [{ id: "mem1", email: "a@x.test", role: "member" }],
				invites: [{ id: "inv1", email: "b@x.test", role: "member" }],
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
		expect((await res.json()) as any).toMatchObject({ error: { message: "Invalid invitation" } });
	});

	it("returns 400 when email is not a string", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await POST(postReq({ email: 5, role: "admin" }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when the request body is missing", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await POST(postReq());
		expect(res.status).toBe(400);
	});

	it("returns 400 when email or role is malformed", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });

		const invalidEmail = await POST(postReq({ email: "not-an-email", role: "member" }));
		expect(invalidEmail.status).toBe(400);

		const invalidRole = await POST(postReq({ email: "valid@example.com", role: "owner" }));
		expect(invalidRole.status).toBe(400);
	});

	it("returns 409 when the email is already a member", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "mem1" }]); // existing member
		const res = await POST(postReq({ email: "A@X.test", role: "member" }));
		expect(res.status).toBe(409);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Already a member" } });
	});

	it("returns 409 when the email already belongs to any account", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]); // no member in this organization
		mock.queueSelect([{ id: "usr_existing" }]); // globally registered user

		const res = await POST(postReq({ email: "existing@x.test", role: "member" }));

		expect(res.status).toBe(409);
		expect((await res.json()) as any).toMatchObject({
			error: { message: "Email already registered" },
		});
	});

	it("refreshes an existing invite and stores only the rotated token hash", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]); // no member
		mock.queueSelect([]); // no globally registered user
		mock.queueSelect([{ id: "inv1" }]); // existing invite
		const res = await POST(postReq({ email: "b@x.test", role: "member" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { invite: { id: "inv1", token: "tok_1" } } });
		expect(mock.updates[0].set).toMatchObject({ role: "member", token: "hashed_tok_1" });
		expect(mock.inserts).toHaveLength(0);
	});

	it("creates a new invite with an admin role and stores only the token hash", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]); // no member
		mock.queueSelect([]); // no globally registered user
		mock.queueSelect([]); // no existing invite
		const res = await POST(postReq({ email: "c@x.test", role: "admin" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { invite: { id: "inv_1", token: "tok_1" } } });
		expect(mock.inserts[0].values).toMatchObject({
			id: "inv_1",
			organizationId: "o1",
			email: "c@x.test",
			role: "admin",
			token: "hashed_tok_1",
		});
	});

	it("normalizes the invited email before checking and storing it", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		mock.queueSelect([]);
		mock.queueSelect([]);
		const res = await POST(postReq({ email: "  D@X.test ", role: "member" }));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({ email: "d@x.test" });
	});
});
