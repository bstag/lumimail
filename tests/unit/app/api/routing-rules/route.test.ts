import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	getCurrentUser: vi.fn(),
	ensureCatchAll: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/ids", () => ({ newId: () => "rule_1" }));
vi.mock("@/lib/cloudflare-api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/cloudflare-api")>()),
	ensureEmailRoutingCatchAllToWorker: m.ensureCatchAll,
}));

import { GET, POST } from "@/app/api/routing-rules/route";

let mock: DbMock;
const authed = { id: "u1", organizationId: "org1", role: "owner" };
const member = { id: "u2", organizationId: "org1", role: "member" };
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
	m.getCurrentUser.mockReset();
	m.ensureCatchAll.mockReset().mockResolvedValue({ enabled: true });
});

describe("POST /api/routing-rules", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		expect((await POST(post(valid))).status).toBe(401);
	});

	it("returns 403 for a restricted member before DB or provider work", async () => {
		m.getCurrentUser.mockResolvedValue(member);
		const res = await POST(post(valid));
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ success: false, error: { message: "Forbidden" } });
		expect(mock.inserts).toHaveLength(0);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});

	it("returns 401 when the user has no organization", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null });
		expect((await POST(post(valid))).status).toBe(401);
	});

	it("returns 400 for an invalid action target", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		const res = await POST(post({ ...valid, mailboxId: undefined }));
		expect(res.status).toBe(400);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});

	it("returns 404 when the domain is missing or cross-tenant", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([]);
		const res = await POST(post(valid));
		expect(res.status).toBe(404);
	});

	it("rejects a wildcard or exact address for another domain", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([domain]);
		let res = await POST(post({ ...valid, pattern: "*@other.test" }));
		expect(res.status).toBe(400);

		mock.queueSelect([domain]);
		res = await POST(post({ ...valid, pattern: "admin@other.test" }));
		expect(res.status).toBe(400);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});

	it("rejects a missing, cross-tenant, or cross-domain mailbox target", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([domain]).queueSelect([]);
		const res = await POST(post(valid));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Target mailbox must belong to the selected domain" } });
	});

	it("returns 409 when the domain already has an internal catch-all", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock
			.queueSelect([domain])
			.queueSelect([{ id: "mb_1", domainId: "dom_1", organizationId: "org1" }])
			.queueSelect([{ id: "existing", pattern: "*@x.test" }]);
		const res = await POST(post(valid));
		expect(res.status).toBe(409);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});

	it("normalizes catch-all, provisions Cloudflare, and creates the rule", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock
			.queueSelect([domain])
			.queueSelect([{ id: "mb_1", domainId: "dom_1", organizationId: "org1" }])
			.queueSelect([]);
		const res = await POST(post(valid));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toMatchObject({ success: true, data: { id: "rule_1", pattern: "*" } });
		expect(m.ensureCatchAll).toHaveBeenCalledWith(expect.anything(), "zone_1");
		expect(mock.inserts[0].values).toMatchObject({ pattern: "*", mailboxId: "mb_1", forwardTo: null });
	});

	it("maps an active provider catch-all conflict to 409", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
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
		m.getCurrentUser.mockResolvedValue(authed);
		mock
			.queueSelect([domain])
			.queueSelect([{ id: "mb_1", domainId: "dom_1", organizationId: "org1" }])
			.queueSelect([]);
		m.ensureCatchAll.mockRejectedValue(new Error("token detail"));
		const res = await POST(post(valid));
		expect(res.status).toBe(502);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Unable to configure Cloudflare catch-all" } });
		expect(mock.inserts).toHaveLength(0);
	});

	it("creates a normalized named forward rule without touching provider catch-all", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([domain]);
		// authorizeForwardDestination: destination is outside every managed domain
		// and this organization owns a verified registration for it.
		mock.queueSelect([]);
		mock.queueSelect([{ id: "fwd_1", address: "outside@example.net", verifiedAt: new Date() }]);
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

	it("refuses a forward rule whose destination is not registered", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([domain]);
		mock.queueSelect([]);
		mock.queueSelect([]); // no ownership row
		const res = await POST(post({
			domainId: "dom_1",
			pattern: "sales@x.test",
			action: "forward",
			forwardTo: "outside@example.net",
			priority: 2,
		}));
		expect(res.status).toBe(422);
		// The rule must not be persisted, or matching mail would be silently dropped.
		expect(mock.inserts).toHaveLength(0);
	});

	it("refuses a forward rule whose destination is registered but unverified", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([domain]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "fwd_1", address: "outside@example.net", verifiedAt: null }]);
		const res = await POST(post({
			domainId: "dom_1",
			pattern: "sales@x.test",
			action: "forward",
			forwardTo: "outside@example.net",
			priority: 2,
		}));
		expect(res.status).toBe(422);
		expect((await res.json()) as { error: { message: string } }).toEqual({
			success: false,
			error: { message: "That destination has not confirmed Cloudflare's verification email yet" },
		});
		expect(mock.inserts).toHaveLength(0);
	});

	it("refuses a forward rule pointing back into a managed domain", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([domain]);
		mock.queueSelect([{ id: "dom_1" }]); // destination hostname is managed
		const res = await POST(post({
			domainId: "dom_1",
			pattern: "sales@x.test",
			action: "forward",
			forwardTo: "loop@x.test",
			priority: 2,
		}));
		expect(res.status).toBe(422);
		expect(mock.inserts).toHaveLength(0);
	});
});

describe("GET /api/routing-rules", () => {
	it("returns the auth response when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		expect((await GET(new Request("https://x.test/api/routing-rules"))).status).toBe(401);
	});

	it("returns 403 for a restricted member before querying", async () => {
		m.getCurrentUser.mockResolvedValue(member);
		const res = await GET(new Request("https://x.test/api/routing-rules"));
		expect(res.status).toBe(403);
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("returns 401 without an organization", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null });
		expect((await GET(new Request("https://x.test/api/routing-rules"))).status).toBe(401);
	});

	it("lists only the authenticated organization rows", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([{ id: "r1", organizationId: "org1" }]);
		const res = await GET(new Request("https://x.test/api/routing-rules"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { rules: [{ id: "r1", organizationId: "org1" }] } });
	});
});
