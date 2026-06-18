import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardOrgAdmin: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/ids", () => ({ newId: () => "alias_1" }));

import { GET, POST } from "@/app/api/aliases/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
});

const getReq = () => new Request("https://x.test/api/aliases");
function postReq(body?: unknown) {
	return new Request("https://x.test/api/aliases", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/aliases", () => {
	it("returns the guard error response (403) for non-admins", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await GET(getReq());
		expect(res.status).toBe(403);
	});

	it("lists aliases for the org", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "a1", localPart: "team" }]);
		const res = await GET(getReq());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { aliases: [{ id: "a1", localPart: "team" }] } });
	});
});

describe("POST /api/aliases", () => {
	it("returns the guard error response (403) for non-admins", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await POST(postReq({ domainId: "d1", localPart: "team" }));
		expect(res.status).toBe(403);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const res = await POST(postReq({ domainId: "", localPart: "bad space" }));
		expect(res.status).toBe(400);
	});

	it("returns 404 when the domain is missing", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await POST(postReq({ domainId: "d1", localPart: "team" }));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Domain not found" } });
	});

	it("returns 404 when the domain belongs to another org", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "other" }]);
		const res = await POST(postReq({ domainId: "d1", localPart: "team" }));
		expect(res.status).toBe(404);
	});

	it("returns 404 when the target mailbox is missing / cross-tenant", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1" }]);
		mock.queueSelect([{ id: "mb1", organizationId: "other" }]);
		const res = await POST(postReq({ domainId: "d1", localPart: "team", targetMailboxId: "mb1" }));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Mailbox not found" } });
	});

	it("creates an alias with a target mailbox", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1" }]);
		mock.queueSelect([{ id: "mb1", organizationId: "o1" }]);
		const res = await POST(
			postReq({ domainId: "d1", localPart: "team", targetMailboxId: "mb1", isGroup: true }),
		);
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			id: "alias_1",
			organizationId: "o1",
			domainId: "d1",
			localPart: "team",
			targetMailboxId: "mb1",
			forwardTo: null,
			isGroup: true,
		});
	});

	it("creates a forwarding alias with defaults applied", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1" }]);
		const res = await POST(postReq({ domainId: "d1", localPart: "team", forwardTo: "ext@ex.com" }));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			id: "alias_1",
			targetMailboxId: null,
			forwardTo: "ext@ex.com",
			isGroup: false,
		});
		const body = (await res.json()) as any;
		expect(body.data).toMatchObject({ id: "alias_1", localPart: "team" });
	});
});
