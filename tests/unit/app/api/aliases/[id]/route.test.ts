import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardOrgAdmin: vi.fn(),
	deleteRule: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/cloudflare-api", () => ({ deleteEmailRoutingRule: m.deleteRule }));

import { DELETE, PATCH } from "@/app/api/aliases/[id]/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const params = (id = "a1") => ({ params: Promise.resolve({ id }) });
const req = () => new Request("https://x.test/api/aliases/a1", { method: "DELETE" });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
	m.deleteRule.mockReset();
	m.deleteRule.mockResolvedValue(undefined);
});

describe("DELETE /api/aliases/[id]", () => {
	it("returns the guard error response (403) for non-admins", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await DELETE(req(), params());
		expect(res.status).toBe(403);
	});

	it("returns 404 when the alias is not found / cross-tenant", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Alias not found" } });
	});

	it("deletes the alias on success", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{
			id: "a1",
			organizationId: "o1",
			zoneId: "z1",
			cloudflareRuleId: "cf_rule_1",
		}]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { ok: true } });
		expect(m.deleteRule).toHaveBeenCalledWith(expect.anything(), "z1", "cf_rule_1");
		expect(mock.deletes).toHaveLength(1);
	});

	it("does not delete D1 when owned Cloudflare cleanup fails", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{
			id: "a1",
			organizationId: "o1",
			zoneId: "z1",
			cloudflareRuleId: "cf_rule_1",
		}]);
		m.deleteRule.mockRejectedValue(new Error("provider failed"));
		const res = await DELETE(req(), params());
		expect(res.status).toBe(502);
		expect(mock.deletes).toHaveLength(0);
	});

	it("leaves a reused manual provider rule alone", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{
			id: "a1",
			organizationId: "o1",
			zoneId: "z1",
			cloudflareRuleId: null,
		}]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect(m.deleteRule).not.toHaveBeenCalled();
		expect(mock.deletes).toHaveLength(1);
	});
});

function patchReq(body: unknown) {
	return new Request("https://x.test/api/aliases/a1", {
		method: "PATCH",
		body: JSON.stringify(body),
	});
}

describe("PATCH /api/aliases/[id]", () => {
	it("returns the guard error response for non-admins", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await PATCH(patchReq({ mailboxIds: ["mb1", "mb2"] }), params());
		expect(res.status).toBe(403);
	});

	it("returns 404 when the group alias is outside the organization", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await PATCH(patchReq({ mailboxIds: ["mb1", "mb2"] }), params());
		expect(res.status).toBe(404);
	});

	it("returns 400 for malformed JSON", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const request = new Request("https://x.test/api/aliases/a1", {
			method: "PATCH",
			body: "{",
		});
		const res = await PATCH(request, params());
		expect(res.status).toBe(400);
	});

	it("replaces explicit group mailbox members", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "a1", organizationId: "o1", isGroup: true }]);
		mock.queueSelect([
			{ id: "mb1", organizationId: "o1" },
			{ id: "mb2", organizationId: "o1" },
		]);
		const res = await PATCH(patchReq({ mailboxIds: ["mb1", "mb2"] }), params());
		expect(res.status).toBe(200);
		expect(mock.deletes).toHaveLength(1);
		expect(mock.inserts[0].values).toEqual([
			expect.objectContaining({ aliasId: "a1", mailboxId: "mb1" }),
			expect.objectContaining({ aliasId: "a1", mailboxId: "mb2" }),
		]);
	});

	it("rejects membership updates for a simple alias", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "a1", organizationId: "o1", isGroup: false }]);
		const res = await PATCH(patchReq({ mailboxIds: ["mb1", "mb2"] }), params());
		expect(res.status).toBe(409);
	});

	it("rejects invalid or cross-tenant mailbox membership", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		let res = await PATCH(patchReq({ mailboxIds: ["mb1"] }), params());
		expect(res.status).toBe(400);

		mock.queueSelect([{ id: "a1", organizationId: "o1", isGroup: true }]);
		mock.queueSelect([{ id: "mb1", organizationId: "other" }]);
		res = await PATCH(patchReq({ mailboxIds: ["mb1", "mb2"] }), params());
		expect(res.status).toBe(404);
	});
});
