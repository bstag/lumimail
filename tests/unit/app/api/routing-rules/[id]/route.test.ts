import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));

import { GET, PATCH, DELETE } from "@/app/api/routing-rules/[id]/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const params = (id = "rule_1") => ({ params: Promise.resolve({ id }) });
const authedOrg = { user: { id: "u1", organizationId: "org1" } };

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
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

	it("updates all recognised fields and returns the updated rule", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1" }]); // lookup
		mock.queueSelect([{ id: "rule_1", action: "forward" }]); // reselect
		const res = await PATCH(
			req({
				action: "forward",
				priority: 9,
				pattern: "*@new.test",
				forwardTo: "x@y.test",
				mailboxId: "mb_1",
			}),
			params(),
		);
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ rule: { id: "rule_1", action: "forward" } });
		expect(mock.updates[0].set).toEqual({
			action: "forward",
			priority: 9,
			pattern: "*@new.test",
			forwardTo: "x@y.test",
			mailboxId: "mb_1",
		});
	});

	it("accepts null forwardTo and mailboxId", async () => {
		m.guardUser.mockResolvedValue(authedOrg);
		mock.queueSelect([{ id: "rule_1" }]);
		mock.queueSelect([{ id: "rule_1" }]);
		const res = await PATCH(req({ forwardTo: null, mailboxId: null }), params());
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toEqual({ forwardTo: null, mailboxId: null });
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
		mock.queueSelect([{ id: "rule_1" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ ok: true });
		expect(mock.deletes.length).toBe(1);
	});
});
