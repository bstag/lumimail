import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	ensureCatchAll: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/ids", () => ({ newId: () => "rule_1" }));
vi.mock("@/lib/cloudflare-api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/cloudflare-api")>()),
	ensureEmailRoutingCatchAllToWorker: m.ensureCatchAll,
}));

import { GET, POST } from "@/app/api/routing-rules/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const authed = { user: { id: "u1", organizationId: "org1" } };
const domain = { id: "dom_1", organizationId: "org1", hostname: "x.test", zoneId: "zone_1" };
const valid = {
	domainId: "dom_1",
	pattern: "*@X.TEST",
	action: "store" as const,
	mailboxId: "mb_1",
	priority: 5,
};

function post(body: unknown) {
	return new Request("https://x.test/api/routing-rules", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.ensureCatchAll.mockReset().mockResolvedValue({ enabled: true });
});

describe("POST /api/routing-rules", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		expect((await POST(post(valid))).status).toBe(401);
	});

	it("returns 400 when the user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		expect((await POST(post(valid))).status).toBe(400);
	});

	it("returns 400 for an invalid action target", async () => {
		m.guardUser.mockResolvedValue(authed);
		const res = await POST(post({ ...valid, mailboxId: undefined }));
		expect(res.status).toBe(400);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});

	it("returns 404 when the domain is missing or cross-tenant", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock.queueSelect([]);
		const res = await POST(post(valid));
		expect(res.status).toBe(404);
	});

	it("rejects a wildcard or exact address for another domain", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock.queueSelect([domain]);
		let res = await POST(post({ ...valid, pattern: "*@other.test" }));
		expect(res.status).toBe(400);

		mock.queueSelect([domain]);
		res = await POST(post({ ...valid, pattern: "admin@other.test" }));
		expect(res.status).toBe(400);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});

	it("rejects a missing, cross-tenant, or cross-domain mailbox target", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock.queueSelect([domain]).queueSelect([]);
		const res = await POST(post(valid));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ error: "Target mailbox must belong to the selected domain" });
	});

	it("returns 409 when the domain already has an internal catch-all", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock
			.queueSelect([domain])
			.queueSelect([{ id: "mb_1", domainId: "dom_1", organizationId: "org1" }])
			.queueSelect([{ id: "existing", pattern: "*@x.test" }]);
		const res = await POST(post(valid));
		expect(res.status).toBe(409);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});

	it("normalizes catch-all, provisions Cloudflare, and creates the rule", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock
			.queueSelect([domain])
			.queueSelect([{ id: "mb_1", domainId: "dom_1", organizationId: "org1" }])
			.queueSelect([]);
		const res = await POST(post(valid));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toMatchObject({ id: "rule_1", pattern: "*" });
		expect(m.ensureCatchAll).toHaveBeenCalledWith(expect.anything(), "zone_1");
		expect(mock.inserts[0].values).toMatchObject({ pattern: "*", mailboxId: "mb_1", forwardTo: null });
	});

	it("maps an active provider catch-all conflict to 409", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock
			.queueSelect([domain])
			.queueSelect([{ id: "mb_1", domainId: "dom_1", organizationId: "org1" }])
			.queueSelect([]);
		m.ensureCatchAll.mockRejectedValue(Object.assign(new Error("conflict"), { name: "CloudflareCatchAllConflictError" }));
		const res = await POST(post(valid));
		expect(res.status).toBe(409);
		expect(mock.inserts).toHaveLength(0);
	});

	it("maps other provider failures to 502 without inserting", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock
			.queueSelect([domain])
			.queueSelect([{ id: "mb_1", domainId: "dom_1", organizationId: "org1" }])
			.queueSelect([]);
		m.ensureCatchAll.mockRejectedValue(new Error("token detail"));
		const res = await POST(post(valid));
		expect(res.status).toBe(502);
		expect((await res.json()) as any).toEqual({ error: "Unable to configure Cloudflare catch-all" });
		expect(mock.inserts).toHaveLength(0);
	});

	it("creates a normalized named forward rule without touching provider catch-all", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock.queueSelect([domain]);
		const res = await POST(post({
			domainId: "dom_1",
			pattern: " Sales@X.TEST ",
			action: "forward",
			forwardTo: "outside@example.net",
			priority: 2,
		}));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			pattern: "sales@x.test",
			mailboxId: null,
			forwardTo: "outside@example.net",
		});
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});
});

describe("GET /api/routing-rules", () => {
	it("returns the auth response when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		expect((await GET(new Request("https://x.test/api/routing-rules"))).status).toBe(401);
	});

	it("requires an organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		expect((await GET(new Request("https://x.test/api/routing-rules"))).status).toBe(400);
	});

	it("lists only the authenticated organization rows", async () => {
		m.guardUser.mockResolvedValue(authed);
		mock.queueSelect([{ id: "r1", organizationId: "org1" }]);
		const res = await GET(new Request("https://x.test/api/routing-rules"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ rules: [{ id: "r1", organizationId: "org1" }] });
	});
});
