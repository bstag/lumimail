import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getPrimaryDomain: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/user", () => ({ getPrimaryDomain: m.getPrimaryDomain }));

import { GET } from "@/app/api/setup/status/route";

beforeEach(() => {
	m.getPrimaryDomain.mockReset();
});

describe("GET /api/setup/status", () => {
	it("reports no primary domain", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		const res = await GET();
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ hasPrimaryDomain: false, primaryDomain: null });
	});

	it("reports an existing primary domain", async () => {
		m.getPrimaryDomain.mockResolvedValue({ id: "d1", hostname: "example.com", extra: "ignored" });
		const res = await GET();
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			hasPrimaryDomain: true,
			primaryDomain: { id: "d1", hostname: "example.com" },
		});
	});
});
