import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn(), guardOrgAdmin: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));

import { GET, PATCH, DELETE } from "@/app/api/mailboxes/[id]/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const params = (id = "mb1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.guardOrgAdmin.mockReset();
});

function req(body?: unknown) {
	return new Request("https://x.test/api/mailboxes/mb1", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/mailboxes/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 with no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await GET(req(), params());
		expect(res.status).toBe(400);
	});

	it("returns 404 when the mailbox is not found / cross-tenant", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await GET(req(), params());
		expect(res.status).toBe(404);
	});

	it("returns the mailbox flagged as primary", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1", email: "me@ex.com" } });
		mock.queueSelect([{ id: "mb1", localPart: "me", hostname: "ex.com" }]);
		const res = await GET(req(), params());
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).mailbox.isPrimary).toBe(true);
	});
});

describe("PATCH /api/mailboxes/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await PATCH(req({ displayName: "x" }), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 with no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await PATCH(req({ displayName: "x" }), params());
		expect(res.status).toBe(400);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		const res = await PATCH(req({ displayName: "x".repeat(101) }), params());
		expect(res.status).toBe(400);
	});

	it("returns 404 when the mailbox is not found", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await PATCH(req({ displayName: "New" }), params());
		expect(res.status).toBe(404);
	});

	it("updates the display name and returns the mailbox", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1", email: "me@ex.com" } });
		mock.queueSelect([{ id: "mb1", localPart: "x", hostname: "ex.com", displayName: "Old" }]);
		mock.queueSelect([{ id: "mb1", localPart: "x", hostname: "ex.com", displayName: "New" }]);
		const res = await PATCH(req({ displayName: "New" }), params());
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toEqual({ displayName: "New" });
		expect(((await res.json()) as any).mailbox.isPrimary).toBe(false);
	});

	it("skips the update when no fields change", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1", email: "me@ex.com" } });
		mock.queueSelect([{ id: "mb1", localPart: "x", hostname: "ex.com" }]);
		mock.queueSelect([{ id: "mb1", localPart: "x", hostname: "ex.com" }]);
		const res = await PATCH(req({}), params());
		expect(res.status).toBe(200);
		expect(mock.updates).toHaveLength(0);
	});
});

describe("DELETE /api/mailboxes/[id]", () => {
	it("returns the organization guard error", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: unauth });
		expect((await DELETE(req({ confirmAddress: "x@ex.com" }), params())).status).toBe(401);
	});

	it("requires an exact address confirmation", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "mb1", localPart: "x", hostname: "ex.com" }]);
		expect((await DELETE(req({ confirmAddress: "wrong@ex.com" }), params())).status).toBe(400);
	});

	it("returns 400 for an unreadable confirmation body", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "mb1", localPart: "x", hostname: "ex.com" }]);
		expect((await DELETE(req(), params())).status).toBe(400);
	});

	it("returns 400 when the address confirmation is not a string", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "mb1", localPart: "x", hostname: "ex.com" }]);
		expect((await DELETE(req({ confirmAddress: null }), params())).status).toBe(400);
	});

	it("returns 404 when the mailbox is not found", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([]);
		expect((await DELETE(req({ confirmAddress: "x@ex.com" }), params())).status).toBe(404);
	});

	it("deletes the confirmed organization mailbox", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "mb1", localPart: "x", hostname: "ex.com" }]);
		const res = await DELETE(req({ confirmAddress: "X@EX.COM" }), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ ok: true });
		expect(mock.deletes).toHaveLength(1);
	});
});
