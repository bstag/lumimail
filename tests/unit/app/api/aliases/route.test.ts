import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardOrgAdmin: vi.fn(),
	ensureRoute: vi.fn(),
	deleteRule: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({ CF_EMAIL_WORKER_NAME: "lumimail" }) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/ids", () => ({ newId: () => "alias_1" }));
vi.mock("@/lib/cloudflare-api", () => ({
	ensureOwnedEmailRoutingRuleToWorker: m.ensureRoute,
	deleteEmailRoutingRule: m.deleteRule,
}));

import { GET, POST } from "@/app/api/aliases/route";

let mock: DbMock;
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardOrgAdmin.mockReset();
	m.ensureRoute.mockReset();
	m.ensureRoute.mockResolvedValue({ rule: { id: "cf_rule_1" }, created: true });
	m.deleteRule.mockReset();
	m.deleteRule.mockResolvedValue(undefined);
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
		mock.queueSelect([
			{ aliasId: "a1", mailboxId: "mb1", localPart: "support", hostname: "other.test" },
			{ aliasId: "a1", mailboxId: "mb2", localPart: "sales", hostname: "example.test" },
		]);
		const res = await GET(getReq());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: {
				aliases: [{
					id: "a1",
					localPart: "team",
					members: [
						{ mailboxId: "mb1", localPart: "support", hostname: "other.test" },
						{ mailboxId: "mb2", localPart: "sales", hostname: "example.test" },
					],
				}],
			},
		});
	});

	it("returns an empty alias list without querying group members", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([]);
		const res = await GET(getReq());
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { aliases: [] },
		});
		expect(mock.db.select).toHaveBeenCalledTimes(1);
	});

	it("lists a mailbox alias with an empty member array", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "a1", localPart: "info", isGroup: false }]);
		mock.queueSelect([]);
		const res = await GET(getReq());
		expect((await res.json()) as any).toMatchObject({
			data: { aliases: [{ id: "a1", members: [] }] },
		});
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
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "team",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Domain not found" } });
	});

	it("returns 404 when the domain belongs to another org", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "other" }]);
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "team",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(404);
	});

	it("returns 404 when a target mailbox is missing or cross-tenant", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]); // source mailbox conflict
		mock.queueSelect([]); // source alias conflict
		mock.queueSelect([{ id: "mb1", organizationId: "other" }]);
		const res = await POST(postReq({
			kind: "group",
			domainId: "d1",
			localPart: "team",
			mailboxIds: ["mb1", "mb2"],
		}));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Mailbox not found" } });
		expect(m.ensureRoute).not.toHaveBeenCalled();
	});

	it("returns 400 for malformed JSON", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		const request = new Request("https://x.test/api/aliases", {
			method: "POST",
			body: "{",
		});
		const res = await POST(request);
		expect(res.status).toBe(400);
	});

	it("creates and provisions a cross-domain mailbox alias", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]); // source mailbox conflict
		mock.queueSelect([]); // source alias conflict
		mock.queueSelect([{ id: "mb1", organizationId: "o1", domainId: "other-domain" }]);
		const res = await POST(
			postReq({ kind: "mailbox", domainId: "d1", localPart: " Info ", targetMailboxId: "mb1" }),
		);
		expect(res.status).toBe(200);
		expect(m.ensureRoute).toHaveBeenCalledWith(expect.anything(), "z1", "info@example.test");
		expect(mock.inserts[0].values).toMatchObject({
			id: "alias_1",
			organizationId: "o1",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
			forwardTo: null,
			isGroup: false,
			cloudflareRuleId: "cf_rule_1",
		});
	});

	it("creates a group and its explicit mailbox members in one D1 batch", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]);
		mock.queueSelect([]);
		mock.queueSelect([
			{ id: "mb1", organizationId: "o1" },
			{ id: "mb2", organizationId: "o1" },
		]);
		const res = await POST(postReq({
			kind: "group",
			domainId: "d1",
			localPart: "team",
			mailboxIds: ["mb1", "mb2"],
		}));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			id: "alias_1",
			targetMailboxId: null,
			forwardTo: null,
			isGroup: true,
			cloudflareRuleId: "cf_rule_1",
		});
		expect(mock.inserts[1].values).toEqual([
			expect.objectContaining({ aliasId: "alias_1", mailboxId: "mb1" }),
			expect.objectContaining({ aliasId: "alias_1", mailboxId: "mb2" }),
		]);
		const body = (await res.json()) as any;
		expect(body.data).toMatchObject({ id: "alias_1", address: "team@example.test" });
	});

	it("returns 409 without provisioning when the source address already exists", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([{ id: "mb-existing" }]);
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(409);
		expect(m.ensureRoute).not.toHaveBeenCalled();
	});

	it("returns 409 for an existing alias at the source address", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "alias-existing" }]);
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(409);
		expect(m.ensureRoute).not.toHaveBeenCalled();
	});

	it("returns 502 without writing D1 when Cloudflare provisioning fails", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "mb1", organizationId: "o1" }]);
		m.ensureRoute.mockRejectedValue(new Error("provider failed"));
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(502);
		expect(mock.inserts).toHaveLength(0);
	});

	it("fails closed when a newly created provider rule has no ID", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "mb1", organizationId: "o1" }]);
		m.ensureRoute.mockResolvedValue({ rule: {}, created: true });
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(502);
		expect(mock.inserts).toHaveLength(0);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it("compensates a newly created provider rule when the D1 batch fails", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "mb1", organizationId: "o1" }]);
		mock.db.batch.mockRejectedValueOnce(new Error("D1 failed"));
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(500);
		expect(m.deleteRule).toHaveBeenCalledWith(expect.anything(), "z1", "cf_rule_1");
	});

	it("does not claim or compensate a reused manual provider rule", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "mb1", organizationId: "o1" }]);
		m.ensureRoute.mockResolvedValue({ rule: { id: "manual-rule" }, created: false });
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({ cloudflareRuleId: null });
		expect(m.deleteRule).not.toHaveBeenCalled();
	});

	it("does not delete a reused manual rule when the D1 write fails", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "mb1", organizationId: "o1" }]);
		m.ensureRoute.mockResolvedValue({ rule: { id: "manual-rule" }, created: false });
		mock.db.batch.mockRejectedValueOnce(new Error("D1 failed"));
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(500);
		expect(m.deleteRule).not.toHaveBeenCalled();
	});

	it("reports a compensation cleanup failure without hiding the D1 failure", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "o1" } });
		mock.queueSelect([{ id: "d1", organizationId: "o1", hostname: "example.test", zoneId: "z1", status: "active" }]);
		mock.queueSelect([]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "mb1", organizationId: "o1" }]);
		mock.db.batch.mockRejectedValueOnce(new Error("D1 failed"));
		m.deleteRule.mockRejectedValueOnce(new Error("cleanup failed"));
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const res = await POST(postReq({
			kind: "mailbox",
			domainId: "d1",
			localPart: "info",
			targetMailboxId: "mb1",
		}));
		expect(res.status).toBe(500);
		expect(error).toHaveBeenCalledWith("Failed to compensate Cloudflare alias routing rule");
		error.mockRestore();
	});
});
