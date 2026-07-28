import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => ({
	guardOrgAdmin: vi.fn(),
	getDomainForUser: vi.fn(),
	getDomainDns: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/domains/service", () => ({
	getDomainForUser: m.getDomainForUser,
	getDomainDns: m.getDomainDns,
}));

import { GET } from "@/app/api/domains/[id]/dns/route";

const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const params = (id = "d1") => ({ params: Promise.resolve({ id }) });
const req = () => new Request("https://x.test/api/domains/d1/dns");

beforeEach(() => {
	m.guardOrgAdmin.mockReset();
	m.getDomainForUser.mockReset();
	m.getDomainDns.mockReset();
});

describe("GET /api/domains/[id]/dns", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 403 for a restricted member before DNS lookup", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await GET(req(), params());
		expect(res.status).toBe(403);
		expect(m.getDomainForUser).not.toHaveBeenCalled();
		expect(m.getDomainDns).not.toHaveBeenCalled();
	});

	it("returns 404 when the domain is not found / cross-tenant", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		m.getDomainForUser.mockResolvedValue(undefined);
		const res = await GET(req(), params());
		expect(res.status).toBe(404);
		expect(m.getDomainForUser).toHaveBeenCalledWith({}, "o1", "d1");
	});

	it("returns the DNS view on success", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		m.getDomainForUser.mockResolvedValue({ id: "d1" });
		m.getDomainDns.mockResolvedValue({ routing: {}, sending: { enabled: true, records: [] } });
		const res = await GET(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { domain: { id: "d1" }, dns: { routing: {}, sending: { enabled: true, records: [] } } },
		});
	});

	it("returns 500 when DNS fetch throws", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		m.getDomainForUser.mockResolvedValue({ id: "d1" });
		m.getDomainDns.mockRejectedValue(new Error("boom"));
		const res = await GET(req(), params());
		expect(res.status).toBe(500);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Failed to fetch DNS" } });
	});
});
