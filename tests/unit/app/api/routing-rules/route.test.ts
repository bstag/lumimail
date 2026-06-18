import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/ids", () => ({ newId: () => "rule_1" }));

import { GET, POST } from "@/app/api/routing-rules/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

const valid = {
	domainId: "dom_1",
	pattern: "*@x.test",
	action: "store" as const,
	priority: 5,
};

function post(body: unknown) {
	return new Request("https://x.test/api/routing-rules", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

describe("GET /api/routing-rules", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(new Request("https://x.test/api/routing-rules"));
		expect(res.status).toBe(401);
	});

	it("returns 400 when user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await GET(new Request("https://x.test/api/routing-rules"));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ error: "No organization" });
	});

	it("lists rules for the organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		mock.queueSelect([{ id: "rule_1" }]);
		const res = await GET(new Request("https://x.test/api/routing-rules"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ rules: [{ id: "rule_1" }] });
	});
});

describe("POST /api/routing-rules", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(post(valid));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		const res = await POST(post({ pattern: "x" }));
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).error).toBeDefined();
	});

	it("returns 404 when domain not found", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		mock.queueSelect([]); // no domain
		const res = await POST(post(valid));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({ error: "Domain not found" });
	});

	it("returns 404 when domain belongs to another org", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		mock.queueSelect([{ id: "dom_1", organizationId: "other" }]);
		const res = await POST(post(valid));
		expect(res.status).toBe(404);
	});

	it("creates a rule, defaulting optional fields to null", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		mock.queueSelect([{ id: "dom_1", organizationId: "org1" }]);
		const res = await POST(post(valid));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toMatchObject({ id: "rule_1", domainId: "dom_1", pattern: "*@x.test" });
		expect(mock.inserts[0].values).toMatchObject({
			id: "rule_1",
			userId: "u1",
			organizationId: "org1",
			domainId: "dom_1",
			mailboxId: null,
			forwardTo: null,
			priority: 5,
		});
	});

	it("creates a rule, preserving provided mailboxId and forwardTo", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		mock.queueSelect([{ id: "dom_1", organizationId: "org1" }]);
		const res = await POST(
			post({ ...valid, action: "forward", mailboxId: "mb_1", forwardTo: "a@b.test" }),
		);
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			mailboxId: "mb_1",
			forwardTo: "a@b.test",
		});
	});
});
