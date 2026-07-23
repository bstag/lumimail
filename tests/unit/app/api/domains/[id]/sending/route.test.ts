import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => ({
	guardUser: vi.fn(),
	getDomainForUser: vi.fn(),
	reconcileDomainSending: vi.fn(),
}));

vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/domains/service", () => ({
	getDomainForUser: m.getDomainForUser,
	reconcileDomainSending: m.reconcileDomainSending,
}));

import { POST } from "@/app/api/domains/[id]/sending/route";

const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const response = await POST(request(), params());
		expect(response.status).toBe(401);
		expect(m.getDomainForUser).not.toHaveBeenCalled();
		expect(m.reconcileDomainSending).not.toHaveBeenCalled();
	});

	it("returns 400 when the user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const response = await POST(request(), params());
		expect(response.status).toBe(400);
		expect(m.reconcileDomainSending).not.toHaveBeenCalled();
	});

	it("returns the same 404 for unknown and cross-tenant domains", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		m.getDomainForUser.mockResolvedValue(null);
		const response = await POST(request(), params("other"));
		expect(response.status).toBe(404);
		expect(m.getDomainForUser).toHaveBeenCalledWith({}, "org1", "other");
		expect(m.reconcileDomainSending).not.toHaveBeenCalled();
	});

	it.each([{}, { action: "manual" }, "not-json"])("returns 400 for an invalid action", async (body) => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
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
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		m.getDomainForUser.mockResolvedValue(domain);
		m.reconcileDomainSending.mockResolvedValue(result);

		const response = await POST(request({ action }), params());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, data: result });
		expect(m.reconcileDomainSending).toHaveBeenCalledWith({}, domain, action);
	});

	it("returns a safe provider failure without changing the route contract", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
		m.getDomainForUser.mockResolvedValue({ id: "dom_1" });
		m.reconcileDomainSending.mockRejectedValue(new Error("token details"));

		const response = await POST(request({ action: "verify" }), params());
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { message: "Cloudflare could not verify Email Sending" },
		});
	});
});
