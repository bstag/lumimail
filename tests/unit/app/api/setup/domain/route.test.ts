import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getPrimaryDomain: vi.fn(),
	hasAnyUser: vi.fn(),
	requireDomainZone: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/user", () => ({
	getPrimaryDomain: m.getPrimaryDomain,
	hasAnyUser: m.hasAnyUser,
}));
vi.mock("@/lib/domains/provision", () => ({
	requireDomainZone: m.requireDomainZone,
}));

import { POST } from "@/app/api/setup/domain/route";

beforeEach(() => {
	m.getPrimaryDomain.mockReset();
	m.hasAnyUser.mockReset();
	m.hasAnyUser.mockResolvedValue(false);
	m.requireDomainZone.mockReset();
});

function req(body?: unknown) {
	return new Request("https://x.test/api/setup/domain", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("POST /api/setup/domain", () => {
	it("returns 409 when a primary domain already exists", async () => {
		m.getPrimaryDomain.mockResolvedValue({ id: "d1" });
		const res = await POST(req({ hostname: "example.com" }));
		expect(res.status).toBe(409);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Primary domain already exists" } });
	});

	it("returns 403 when users exist even without a primary domain", async () => {
		// The route is first-boot only. Removing every domain later must not
		// reopen unauthenticated provisioning on an instance that has users.
		m.getPrimaryDomain.mockResolvedValue(null);
		m.hasAnyUser.mockResolvedValue(true);
		const res = await POST(req({ hostname: "example.com" }));
		expect(res.status).toBe(403);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Setup is complete" } });
		expect(m.requireDomainZone).not.toHaveBeenCalled();
	});

	it("returns 400 for an invalid hostname", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		const res = await POST(req({ hostname: "nope" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Validation failed" } });
	});

	it("checks the zone without provisioning or exposing provider metadata", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		m.requireDomainZone.mockResolvedValue({ id: "z1", name: "example.com" });
		const res = await POST(req({ hostname: "example.com" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: {
				domain: { hostname: "example.com" },
			},
		});
		expect(m.requireDomainZone).toHaveBeenCalledWith({}, "example.com");
	});

	it("returns 502 when zone lookup fails", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		m.requireDomainZone.mockRejectedValue(new Error("cf down"));
		const res = await POST(req({ hostname: "example.com" }));
		expect(res.status).toBe(502);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Domain setup failed" } });
	});
});
