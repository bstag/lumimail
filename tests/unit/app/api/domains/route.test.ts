import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => {
	class DomainAlreadyRegisteredError extends Error {
		constructor() {
			super("Domain is already registered");
			this.name = "DomainAlreadyRegisteredError";
		}
	}
	return {
		guardOrgAdmin: vi.fn(),
		listUserDomains: vi.fn(),
		getDomainDns: vi.fn(),
		addDomainForUser: vi.fn(),
		DomainAlreadyRegisteredError,
	};
});
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/domains/service", () => ({
	listUserDomains: m.listUserDomains,
	getDomainDns: m.getDomainDns,
	addDomainForUser: m.addDomainForUser,
	DomainAlreadyRegisteredError: m.DomainAlreadyRegisteredError,
}));

import { GET, POST } from "@/app/api/domains/route";

const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	m.guardOrgAdmin.mockReset();
	m.listUserDomains.mockReset();
	m.getDomainDns.mockReset();
	m.addDomainForUser.mockReset();
});

function getReq(url = "https://x.test/api/domains") {
	return new Request(url);
}

function postReq(body?: unknown) {
	return new Request("https://x.test/api/domains", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/domains", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(getReq());
		expect(res.status).toBe(401);
	});

	it("returns 403 for a restricted member without listing domains", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const res = await GET(getReq());
		expect(res.status).toBe(403);
		expect(m.listUserDomains).not.toHaveBeenCalled();
	});

	it("lists domains without DNS by default", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		m.listUserDomains.mockResolvedValue([{ id: "d1" }]);
		const res = await GET(getReq());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { domains: [{ id: "d1" }] },
		});
		expect(m.getDomainDns).not.toHaveBeenCalled();
	});

	it("includes a DNS summary for fulfilled domains and skips rejected ones", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		m.listUserDomains.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
		m.getDomainDns.mockImplementation(async (_env: unknown, domain: { id: string }) => {
			if (domain.id === "d2") throw new Error("boom");
			return { routing: { records: [], missing: [] }, sending: { enabled: false, records: [] } };
		});
		const res = await GET(getReq("https://x.test/api/domains?includeDns=true"));
		expect(res.status).toBe(200);
		const body = ((await res.json()) as any).data;
		expect(body.dns.d1).toBeDefined();
		expect(body.dns.d2).toBeUndefined();
	});
});

describe("POST /api/domains", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(postReq({ hostname: "example.com" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		const res = await POST(postReq({ hostname: "nope" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Validation failed" } });
	});

	it("adds a domain on success", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		m.addDomainForUser.mockResolvedValue({ id: "d1" });
		const res = await POST(postReq({ hostname: "example.com", enableRouting: true, enableSending: false }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { id: "d1" } });
		expect(m.addDomainForUser).toHaveBeenCalledWith({}, "u1", "o1", "example.com", {
			enableRouting: true,
			enableSending: false,
		});
	});

	it("returns 409 when the hostname is already registered to another organization", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		m.addDomainForUser.mockRejectedValue(new m.DomainAlreadyRegisteredError());
		const res = await POST(postReq({ hostname: "example.com" }));
		expect(res.status).toBe(409);
		expect((await res.json()) as any).toMatchObject({
			error: { message: "Domain is already registered" },
		});
	});

	it("returns 400 when Cloudflare provisioning fails", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "o1" } });
		m.addDomainForUser.mockRejectedValue(new Error("zone lookup failed"));
		const res = await POST(postReq({ hostname: "example.com" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Failed to add domain" } });
	});
});
