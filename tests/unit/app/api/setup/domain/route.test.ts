import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getPrimaryDomain: vi.fn(),
	provisionDomainOnCloudflare: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/user", () => ({ getPrimaryDomain: m.getPrimaryDomain }));
vi.mock("@/lib/domains/provision", () => ({
	provisionDomainOnCloudflare: m.provisionDomainOnCloudflare,
}));

import { POST } from "@/app/api/setup/domain/route";

beforeEach(() => {
	m.getPrimaryDomain.mockReset();
	m.provisionDomainOnCloudflare.mockReset();
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

	it("returns 400 for an invalid hostname", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		const res = await POST(req({ hostname: "nope" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Validation failed" } });
	});

	it("provisions the domain on success", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		m.provisionDomainOnCloudflare.mockResolvedValue({
			hostname: "example.com",
			zone: { id: "z1" },
			routingEnabled: true,
			sendingEnabled: true,
		});
		const res = await POST(req({ hostname: "example.com" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: {
				domain: { hostname: "example.com", zoneId: "z1", routingEnabled: true, sendingEnabled: true },
			},
		});
		expect(m.provisionDomainOnCloudflare).toHaveBeenCalledWith({}, "example.com", {
			enableRouting: true,
			enableSending: true,
		});
	});

	it("returns 502 when provisioning throws", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		m.provisionDomainOnCloudflare.mockRejectedValue(new Error("cf down"));
		const res = await POST(req({ hostname: "example.com" }));
		expect(res.status).toBe(502);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Domain setup failed" } });
	});
});
