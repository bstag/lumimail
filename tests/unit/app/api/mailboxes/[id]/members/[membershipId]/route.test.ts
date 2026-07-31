import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn(), getMailboxAccess: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/auth/mailbox-access", () => ({ getMailboxAccess: m.getMailboxAccess }));

import { DELETE, PATCH } from "@/app/api/mailboxes/[id]/members/[membershipId]/route";

let mock: DbMock;
const params = { params: Promise.resolve({ id: "mbx_1", membershipId: "mbm_2" }) };
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const patchRequest = (body: unknown) => new Request("https://x.test/api/mailboxes/mbx_1/members/mbm_2", {
	method: "PATCH", body: JSON.stringify(body),
});
const deleteRequest = () => new Request("https://x.test/api/mailboxes/mbx_1/members/mbm_2", { method: "DELETE" });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
	m.getMailboxAccess.mockReset();
});

describe("PATCH mailbox membership", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		expect((await PATCH(patchRequest({ role: "viewer" }), params)).status).toBe(401);
	});

	it("hides the resource without an organization or manager grant", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null });
		expect((await PATCH(patchRequest({ role: "viewer" }), params)).status).toBe(404);
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "responder" });
		expect((await PATCH(patchRequest({ role: "viewer" }), params)).status).toBe(404);
	});

	it("rejects an invalid role", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		expect((await PATCH(patchRequest({ role: "owner" }), params)).status).toBe(400);
	});

	it("returns 404 for a membership outside the mailbox", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([]);
		expect((await PATCH(patchRequest({ role: "viewer" }), params)).status).toBe(404);
	});

	it("prevents demoting the last manager", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ id: "mbm_2", role: "manager" }]).queueSelect([{ value: 1 }]);
		expect((await PATCH(patchRequest({ role: "responder" }), params)).status).toBe(409);
	});

	it("fails closed when the manager count query returns no row", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ id: "mbm_2", role: "manager" }]).queueSelect([]);
		expect((await PATCH(patchRequest({ role: "viewer" }), params)).status).toBe(409);
	});

	it("updates a role when another manager remains", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ id: "mbm_2", role: "manager" }]).queueSelect([{ value: 2 }]);
		const response = await PATCH(patchRequest({ role: "responder" }), params);
		expect(response.status).toBe(200);
		expect(mock.updates[0].set).toMatchObject({ role: "responder" });
	});

	it("updates a non-manager without a manager count query", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ id: "mbm_2", role: "viewer" }]);
		expect((await PATCH(patchRequest({ role: "responder" }), params)).status).toBe(200);
	});
});

describe("DELETE mailbox membership", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		expect((await DELETE(deleteRequest(), params)).status).toBe(401);
	});

	it("hides the resource without an organization or manager grant", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null });
		expect((await DELETE(deleteRequest(), params)).status).toBe(404);
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue(null);
		expect((await DELETE(deleteRequest(), params)).status).toBe(404);
	});

	it("returns 404 for an unknown membership", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([]);
		expect((await DELETE(deleteRequest(), params)).status).toBe(404);
	});

	it("prevents removing the last manager", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ id: "mbm_2", role: "manager" }]).queueSelect([{ value: 1 }]);
		expect((await DELETE(deleteRequest(), params)).status).toBe(409);
	});

	it("removes a manager when another remains", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ id: "mbm_2", role: "manager" }]).queueSelect([{ value: 2 }]);
		expect((await DELETE(deleteRequest(), params)).status).toBe(200);
		expect(mock.deletes).toHaveLength(1);
	});

	it("removes a non-manager without a manager count query", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMailboxAccess.mockResolvedValue({ role: "manager" });
		mock.queueSelect([{ id: "mbm_2", role: "viewer" }]);
		expect((await DELETE(deleteRequest(), params)).status).toBe(200);
	});
});
