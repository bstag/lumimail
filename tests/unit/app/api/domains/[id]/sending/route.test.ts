import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => ({
	guardOrgAdmin: vi.fn(),
	getDomainForUser: vi.fn(),
	reconcileDomainSending: vi.fn(),
}));

vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: m.guardOrgAdmin }));
vi.mock("@/lib/domains/service", () => ({
	getDomainForUser: m.getDomainForUser,
	reconcileDomainSending: m.reconcileDomainSending,
}));

import { POST } from "@/app/api/domains/[id]/sending/route";

const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const params = (id = "dom_1") => ({ params: Promise.resolve({ id }) });

function request(body: unknown = { action: "verify" }) {
	return new Request("https://x.test/api/domains/dom_1/sending", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("POST /api/domains/[id]/sending", () => {
	it("returns 401 without a session and never calls Cloudflare", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: unauth });
		const response = await POST(request(), params());
		expect(response.status).toBe(401);
		expect(m.getDomainForUser).not.toHaveBeenCalled();
		expect(m.reconcileDomainSending).not.toHaveBeenCalled();
	});

	it("returns 403 for a restricted member before provider work", async () => {
		m.guardOrgAdmin.mockResolvedValue({ errorResponse: forbidden });
		const response = await POST(request(), params());
		expect(response.status).toBe(403);
		expect(m.getDomainForUser).not.toHaveBeenCalled();
		expect(m.reconcileDomainSending).not.toHaveBeenCalled();
	});

	it("returns the same 404 for unknown and cross-tenant domains", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "org1" } });
		m.getDomainForUser.mockResolvedValue(null);
		const response = await POST(request(), params("other"));
		expect(response.status).toBe(404);
		expect(m.getDomainForUser).toHaveBeenCalledWith({}, "org1", "other");
		expect(m.reconcileDomainSending).not.toHaveBeenCalled();
	});

	it.each([{}, { action: "manual" }, "not-json"])("returns 400 for an invalid action", async (body) => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "org1" } });
		m.getDomainForUser.mockResolvedValue({ id: "dom_1" });
		const response = await POST(request(body), params());
		expect(response.status).toBe(400);
		expect(m.reconcileDomainSending).not.toHaveBeenCalled();
	});

	it.each(["verify", "enable"] as const)("reconciles the provider-backed %s action", async (action) => {
		const domain = { id: "dom_1", organizationId: "org1", hostname: "example.com" };
		const result = {
			domain: { ...domain, sendingEnabled: true, sendingSubdomainTag: "tag1" },
			dns: { sending: { enabled: true, records: [{ type: "TXT" }] } },
		};
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "org1" } });
		m.getDomainForUser.mockResolvedValue(domain);
		m.reconcileDomainSending.mockResolvedValue(result);

		const response = await POST(request({ action }), params());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, data: result });
		expect(m.reconcileDomainSending).toHaveBeenCalledWith({}, domain, action);
	});

	it("returns a safe provider failure without changing the route contract", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: { id: "u1", organizationId: "org1" } });
		m.getDomainForUser.mockResolvedValue({ id: "dom_1" });
		m.reconcileDomainSending.mockRejectedValue(new Error("token details"));

		const response = await POST(request({ action: "verify" }), params());
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { message: "Cloudflare could not verify Email Sending" },
		});
	});
});
