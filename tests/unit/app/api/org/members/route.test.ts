import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardOrgAdmin: vi.fn(),
	listInvites: vi.fn(),
	createInvite: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/organization-invitations", () => ({
	listOrganizationInvitations: m.listInvites,
	createOrganizationInvitation: m.createInvite,
}));

import { GET, POST } from "@/app/api/org/members/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
	m.listInvites.mockReset().mockResolvedValue([]);
	m.createInvite.mockReset().mockResolvedValue({
		status: "created", inviteId: "inv_1", token: "tok_1", deliveryStatus: "sent",
	});
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
		m.listInvites.mockResolvedValue([{ id: "inv1", email: "b@x.test", role: "member" }]);
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
		m.createInvite.mockResolvedValue({ status: "already-member" });
		const res = await POST(postReq({ email: "A@X.test", role: "member" }));
		expect(res.status).toBe(409);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Already a member" } });
	});

	it("returns 409 when the email already belongs to any account", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		m.createInvite.mockResolvedValue({ status: "email-registered" });

		const res = await POST(postReq({ email: "existing@x.test", role: "member" }));

		expect(res.status).toBe(409);
		expect((await res.json()) as any).toMatchObject({
			error: { message: "Email already registered" },
		});
	});

	it("returns the delivery state and one-time plaintext token from the service", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		m.createInvite.mockResolvedValue({ status: "created", inviteId: "inv1", token: "tok_1", deliveryStatus: "failed" });
		const res = await POST(postReq({ email: "b@x.test", role: "member" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { invite: { id: "inv1", token: "tok_1", deliveryStatus: "failed" } } });
	});

	it("passes normalized identity and role to the lifecycle service", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await POST(postReq({ email: "c@x.test", role: "admin" }));
		expect(res.status).toBe(200);
		expect(m.createInvite).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "o1", email: "c@x.test", role: "admin",
		});
	});

	it("normalizes the invited email before checking and storing it", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await POST(postReq({ email: "  D@X.test ", role: "member" }));
		expect(res.status).toBe(200);
		expect(m.createInvite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: "d@x.test" }));
	});

	it("maps cooldown and service unavailability without provider detail", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		m.createInvite.mockResolvedValueOnce({ status: "rate-limited" });
		expect((await POST(postReq({ email: "a@x.test", role: "member" }))).status).toBe(429);
		m.createInvite.mockResolvedValueOnce({ status: "unavailable" });
		expect((await POST(postReq({ email: "a@x.test", role: "member" }))).status).toBe(503);
	});

	it("bounds an unexpected invitation service failure", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		m.createInvite.mockRejectedValueOnce(new Error("database secret detail"));
		const response = await POST(postReq({ email: "a@x.test", role: "member" }));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ success: false, error: { message: "Invitation service temporarily unavailable" } });
		expect(error).toHaveBeenCalledWith(JSON.stringify({ message: "organization invitation creation failed" }));
		error.mockRestore();
	});
});
