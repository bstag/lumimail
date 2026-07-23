import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	guardOrgAdmin: vi.fn(),
	ensureRule: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/cloudflare-api", () => ({ ensureEmailRoutingRuleToWorker: m.ensureRule }));
vi.mock("@/lib/ids", () => ({ newId: () => "mbx_1" }));

import { GET, POST } from "@/app/api/mailboxes/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.guardOrgAdmin.mockReset();
	m.ensureRule.mockReset();
});

const getReq = () => new Request("https://x.test/api/mailboxes");
function postReq(body?: unknown) {
	return new Request("https://x.test/api/mailboxes", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/mailboxes", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(getReq());
		expect(res.status).toBe(401);
	});

	it("returns 400 with no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await GET(getReq());
		expect(res.status).toBe(400);
	});

	it("lists mailboxes and flags the primary one", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1", email: "me@ex.com" } });
		mock.queueSelect([
			{ id: "mb1", localPart: "me", hostname: "ex.com", role: "manager" },
			{ id: "mb2", localPart: "other", hostname: "ex.com", role: "viewer" },
		]);
		const res = await GET(getReq());
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.mailboxes[0].isPrimary).toBe(true);
		expect(body.mailboxes[1].isPrimary).toBe(false);
		expect(body.mailboxes.map((mailbox: { role: string }) => mailbox.role)).toEqual(["manager", "viewer"]);
	});
});

describe("POST /api/mailboxes", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(postReq({ domainId: "d1", localPart: "a" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		const res = await POST(postReq({ domainId: "", localPart: "" }));
		expect(res.status).toBe(400);
	});

	it("returns 404 when the domain is missing", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await POST(postReq({ domainId: "d1", localPart: "a" }));
		expect(res.status).toBe(404);
	});

	it("returns 404 when the domain belongs to another org", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "other", hostname: "ex.com" }]);
		const res = await POST(postReq({ domainId: "d1", localPart: "a" }));
		expect(res.status).toBe(404);
	});

	it("returns 409 when the mailbox already exists", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "ex.com", zoneId: "z1" }]);
		mock.queueSelect([{ id: "mbx_old" }]);
		const res = await POST(postReq({ domainId: "d1", localPart: "Abc" }));
		expect(res.status).toBe(409);
	});

	it("returns 502 when the Cloudflare routing rule fails", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "ex.com", zoneId: "z1" }]);
		mock.queueSelect([]);
		m.ensureRule.mockRejectedValue(new Error("cf"));
		const res = await POST(postReq({ domainId: "d1", localPart: "a" }));
		expect(res.status).toBe(502);
	});

	it("creates a mailbox on success", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "ex.com", zoneId: "z1" }]);
		mock.queueSelect([]);
		m.ensureRule.mockResolvedValue(undefined);
		const res = await POST(postReq({ domainId: "d1", localPart: "Hello", displayName: "Hi" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { id: "mbx_1", address: "hello@ex.com" },
		});
		expect(m.ensureRule).toHaveBeenCalledWith({}, "z1", "hello@ex.com");
		expect(mock.inserts[0].values).toMatchObject({
			id: "mbx_1",
			userId: "u1",
			organizationId: "o1",
			domainId: "d1",
			localPart: "hello",
			displayName: "Hi",
		});
		expect(mock.inserts[1].values).toMatchObject({
			mailboxId: "mbx_1",
			userId: "u1",
			role: "manager",
		});
	});
});
