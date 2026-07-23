import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	getMailboxAccess: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/auth/mailbox-access", () => ({ getMailboxAccess: m.getMailboxAccess }));
vi.mock("@/lib/ids", () => ({ newId: () => "mbm_1" }));

import { GET, POST } from "@/app/api/mailboxes/[id]/members/route";

let mock: DbMock;
const params = { params: Promise.resolve({ id: "mbx_1" }) };
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const request = (body?: unknown) => new Request("https://x.test/api/mailboxes/mbx_1/members", {
	method: body === undefined ? "GET" : "POST",
	body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.getMailboxAccess.mockReset();
});

describe("mailbox membership collection", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		expect((await GET(request(), params)).status).toBe(401);
	});

	it("hides the mailbox when the user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: null } });
		expect((await GET(request(), params)).status).toBe(404);
	});

	it("hides membership lists from non-managers", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: "org_1" } });
		m.getMailboxAccess.mockResolvedValue({ role: "responder" });
		expect((await GET(request(), params)).status).toBe(404);
	});

	it("lists members for a manager", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: "org_1" } });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ id: "mbm_1", userId: "usr_2", name: "Sam", email: "sam@example.com", role: "responder" }]);
		mock.queueSelect([{ userId: "usr_1", name: "Manager", email: "manager@example.com" }]);
		const response = await GET(request(), params);
		expect(response.status).toBe(200);
		expect((await response.json()) as unknown).toMatchObject({
			success: true,
			data: {
				members: [{ role: "responder" }],
				workspaceMembers: [{ userId: "usr_1" }],
			},
		});
	});

	it("adds an organization member when the caller manages the mailbox", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: "org_1" } });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ userId: "usr_2" }]).queueSelect([]);
		const response = await POST(request({ userId: "usr_2", role: "responder" }), params);
		expect(response.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			id: "mbm_1", mailboxId: "mbx_1", userId: "usr_2", role: "responder",
		});
	});

	it("returns 401 for an unauthenticated membership creation", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		expect((await POST(request({ userId: "usr_2", role: "viewer" }), params)).status).toBe(401);
	});

	it("hides the mailbox when a membership creator has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: null } });
		expect((await POST(request({ userId: "usr_1", role: "manager" }), params)).status).toBe(404);
	});

	it("rejects invalid membership input", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: "org_1" } });
		expect((await POST(request({ userId: "", role: "owner" }), params)).status).toBe(400);
	});

	it("rejects users outside the organization without revealing them", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: "org_1" } });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([]);
		expect((await POST(request({ userId: "outside", role: "viewer" }), params)).status).toBe(404);
	});

	it("allows an organization owner to explicitly grant themselves manager access", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "owner_1", organizationId: "org_1" } });
		m.getMailboxAccess.mockResolvedValue(null);
		mock.queueSelect([{ role: "owner" }]).queueSelect([{ userId: "owner_1" }]).queueSelect([]);
		const response = await POST(request({ userId: "owner_1", role: "manager" }), params);
		expect(response.status).toBe(200);
	});

	it("does not let a non-owner grant themselves manager access", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: "org_1" } });
		m.getMailboxAccess.mockResolvedValue(null);
		mock.queueSelect([]);
		expect((await POST(request({ userId: "usr_1", role: "manager" }), params)).status).toBe(404);
	});

	it("does not let a non-manager assign another user", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: "org_1" } });
		m.getMailboxAccess.mockResolvedValue({ role: "viewer" });
		expect((await POST(request({ userId: "usr_2", role: "viewer" }), params)).status).toBe(404);
	});

	it("returns 409 for an existing membership", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "usr_1", organizationId: "org_1" } });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ userId: "usr_2" }]).queueSelect([{ id: "existing" }]);
		expect((await POST(request({ userId: "usr_2", role: "viewer" }), params)).status).toBe(409);
	});
});
