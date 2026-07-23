import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	ensureCatchAll: vi.fn(),
	disableCatchAll: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/cloudflare-api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/cloudflare-api")>()),
	ensureEmailRoutingCatchAllToWorker: m.ensureCatchAll,
	disableEmailRoutingCatchAllToWorker: m.disableCatchAll,
}));

import { GET, PATCH, DELETE } from "@/app/api/routing-rules/[id]/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const params = (id = "rule_1") => ({ params: Promise.resolve({ id }) });
const authedOrg = { user: { id: "u1", organizationId: "org1" } };

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.ensureCatchAll.mockReset().mockResolvedValue({ enabled: true });
	m.disableCatchAll.mockReset().mockResolvedValue({ enabled: false });
});

function req(body?: unknown) {
	return new Request("https://x.test/api/routing-rules/rule_1", {
		method: "PATCH",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/routing-rules/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 when user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await GET(req(), params());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ error: "No organization" });
	});

	it("returns 404 when rule not found / cross-tenant", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([]);
		const res = await GET(req(), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({ error: "Not found" });
	});

	it("returns the rule on success", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", action: "store" }]);
		const res = await GET(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ rule: { id: "rule_1", action: "store" } });
	});
});

describe("PATCH /api/routing-rules/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await PATCH(req({ action: "store" }), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 when user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await PATCH(req({ action: "store" }), params());
		expect(res.status).toBe(400);
	});

	it("returns 404 when rule not found / cross-tenant", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([]); // lookup
		const res = await PATCH(req({ action: "store" }), params());
		expect(res.status).toBe(404);
	});

	it("returns 400 when no valid fields to update", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1" }]); // lookup found
		const res = await PATCH(req({ ignored: true }), params());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ error: "No valid fields to update" });
	});

	it("normalizes and validates a catch-all transition before updating", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "old", action: "store", mailboxId: "mb_1", priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		mock.queueSelect([{ id: "mb_1", domainId: "dom_1", organizationId: "org1" }]);
		mock.queueSelect([]); // no other catch-all
		mock.queueSelect([{ id: "rule_1", action: "store", pattern: "*" }]);
		const res = await PATCH(
			req({
				priority: 9,
				pattern: "*@x.test",
				mailboxId: "mb_1",
			}),
			params(),
		);
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toMatchObject({ pattern: "*", priority: 9, mailboxId: "mb_1", forwardTo: null });
		expect(m.ensureCatchAll).toHaveBeenCalledWith(expect.anything(), "z1");
	});

	it("returns 400 for an invalid update shape", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1" }]);
		const res = await PATCH(req({ priority: "high" }), params());
		expect(res.status).toBe(400);
	});

	it("returns 404 when the rule's domain is missing", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "gone" }]).queueSelect([]);
		const res = await PATCH(req({ priority: 2 }), params());
		expect(res.status).toBe(404);
	});

	it("rejects a malformed pattern update", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "admin", action: "reject", priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		const res = await PATCH(req({ pattern: "bad*pattern" }), params());
		expect(res.status).toBe(400);
	});

	it("rejects a missing store target during update", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "admin", action: "reject", mailboxId: null, priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		mock.queueSelect([]);
		const res = await PATCH(req({ action: "store", mailboxId: "missing" }), params());
		expect(res.status).toBe(400);
	});

	it("rejects another catch-all including a legacy wildcard spelling", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "admin", action: "reject", priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		mock.queueSelect([
			{ id: "invalid", pattern: "bad*pattern" },
			{ id: "existing", pattern: "*@x.test" },
		]);
		const res = await PATCH(req({ pattern: "*" }), params());
		expect(res.status).toBe(409);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
	});

	it("maps a provider conflict during catch-all transition to 409", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "admin", action: "reject", priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		mock.queueSelect([]);
		m.ensureCatchAll.mockRejectedValue(Object.assign(new Error("conflict"), { name: "CloudflareCatchAllConflictError" }));
		const res = await PATCH(req({ pattern: "*" }), params());
		expect(res.status).toBe(409);
	});

	it("updates to a forward action and clears the mailbox target", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "admin", action: "store", mailboxId: "mb1", forwardTo: null, priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		mock.queueSelect([{ id: "rule_1", action: "forward" }]);
		const res = await PATCH(req({ action: "forward", forwardTo: "outside@example.net" }), params());
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toMatchObject({ action: "forward", mailboxId: null, forwardTo: "outside@example.net" });
	});

	it("updates a named reject rule without touching the provider", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "admin", action: "reject", priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		mock.queueSelect([{ id: "rule_1", priority: 2 }]);
		const res = await PATCH(req({ priority: 2 }), params());
		expect(res.status).toBe(200);
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
		expect(m.disableCatchAll).not.toHaveBeenCalled();
	});

	it("rejects invalid merged action targets", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "a", action: "store", mailboxId: "mb_1", priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		const res = await PATCH(req({ mailboxId: null }), params());
		expect(res.status).toBe(400);
		expect(mock.updates).toHaveLength(0);
	});

	it("disables the provider catch-all when changing the last catch-all to a named rule", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "*", action: "reject", mailboxId: null, forwardTo: null, priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		mock.queueSelect([]); // no other catch-all in the zone
		mock.queueSelect([{ id: "rule_1", pattern: "admin", action: "reject" }]);
		const res = await PATCH(req({ pattern: "admin" }), params());
		expect(res.status).toBe(200);
		expect(m.disableCatchAll).toHaveBeenCalledWith(expect.anything(), "z1");
	});

	it("returns 502 and leaves the row unchanged when catch-all disable fails", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "*", action: "reject", mailboxId: null, forwardTo: null, priority: 1 }]);
		mock.queueSelect([{ id: "dom_1", hostname: "x.test", zoneId: "z1", organizationId: "org1" }]);
		mock.queueSelect([]); // no other catch-all in the zone
		m.disableCatchAll.mockRejectedValue(new Error("provider"));
		const res = await PATCH(req({ pattern: "admin" }), params());
		expect(res.status).toBe(502);
		expect(mock.updates).toHaveLength(0);
	});
});

describe("DELETE /api/routing-rules/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await DELETE(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 when user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await DELETE(req(), params());
		expect(res.status).toBe(400);
	});

	it("returns 404 when rule not found / cross-tenant", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
	});

	it("deletes an existing rule", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "admin" }]);
		mock.queueSelect([{ id: "dom_1", zoneId: "z1", organizationId: "org1", hostname: "x.test" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ ok: true });
		expect(mock.deletes.length).toBe(1);
	});

	it("returns 404 when the catch-all domain disappeared", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "gone", pattern: "*" }]).queueSelect([]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
	});

	it("disables provider delivery before deleting a catch-all", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "*" }]);
		mock.queueSelect([{ id: "dom_1", zoneId: "z1", organizationId: "org1", hostname: "x.test" }]);
		mock.queueSelect([]); // no other catch-all in the zone
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect(m.disableCatchAll).toHaveBeenCalledWith(expect.anything(), "z1");
		expect(mock.deletes).toHaveLength(1);
	});

	it("does not delete a catch-all when provider disable fails", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "*" }]);
		mock.queueSelect([{ id: "dom_1", zoneId: "z1", organizationId: "org1", hostname: "x.test" }]);
		mock.queueSelect([]); // no other catch-all in the zone
		m.disableCatchAll.mockRejectedValue(new Error("provider"));
		const res = await DELETE(req(), params());
		expect(res.status).toBe(502);
		expect(mock.deletes).toHaveLength(0);
	});

	it("keeps the zone catch-all enabled when another domain in the zone still uses it", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1", domainId: "dom_1", pattern: "*" }]);
		mock.queueSelect([{ id: "dom_1", zoneId: "z1", organizationId: "org1", hostname: "x.test" }]);
		mock.queueSelect([{ pattern: "*@second.x.test", hostname: "second.x.test" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect(m.disableCatchAll).not.toHaveBeenCalled();
		expect(mock.deletes).toHaveLength(1);
	});
});
