import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => ({
	guardUser: vi.fn(),
	listUserDomains: vi.fn(),
	getDomainDns: vi.fn(),
	addDomainForUser: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/domains/service", () => ({
	listUserDomains: m.listUserDomains,
	getDomainDns: m.getDomainDns,
	addDomainForUser: m.addDomainForUser,
}));

import { GET, POST } from "@/app/api/domains/route";

const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	m.guardUser.mockReset();
	m.listUserDomains.mockReset();
	m.getDomainDns.mockReset();
	m.addDomainForUser.mockReset();
});

function getReq(url = "https://x.test/api/domains") {
	// minimal NextRequest-like: only nextUrl.searchParams is used
	const u = new URL(url);
	return { nextUrl: { searchParams: u.searchParams } } as unknown as Parameters<typeof GET>[0];
}

function postReq(body?: unknown) {
	return new Request("https://x.test/api/domains", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/domains", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(getReq());
		expect(res.status).toBe(401);
	});

	it("returns 400 when the user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await GET(getReq());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "No organization" } });
	});

	it("lists domains without DNS by default", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.listUserDomains.mockResolvedValue([{ id: "d1" }]);
		const res = await GET(getReq());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ domains: [{ id: "d1" }] });
		expect(m.getDomainDns).not.toHaveBeenCalled();
	});

	it("includes a DNS summary for fulfilled domains and skips rejected ones", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.listUserDomains.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
		m.getDomainDns.mockImplementation(async (_env: unknown, domain: { id: string }) => {
			if (domain.id === "d2") throw new Error("boom");
			return { routing: { records: [], missing: [] }, sending: [] };
		});
		const res = await GET(getReq("https://x.test/api/domains?includeDns=true"));
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.dns.d1).toBeDefined();
		expect(body.dns.d2).toBeUndefined();
	});
});

describe("POST /api/domains", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(postReq({ hostname: "example.com" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		const res = await POST(postReq({ hostname: "nope" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Validation failed" } });
	});

	it("adds a domain on success", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.addDomainForUser.mockResolvedValue({ id: "d1" });
		const res = await POST(postReq({ hostname: "example.com", enableRouting: true, enableSending: false }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { id: "d1" } });
		expect(m.addDomainForUser).toHaveBeenCalledWith({}, "u1", "o1", "example.com", {
			enableRouting: true,
			enableSending: false,
		});
	});

	it("returns 400 when the service throws", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.addDomainForUser.mockRejectedValue(new Error("dup"));
		const res = await POST(postReq({ hostname: "example.com" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Failed to add domain" } });
	});
});
