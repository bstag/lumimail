import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ seedDemoData: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/seed", () => ({ seedDemoData: m.seedDemoData }));
vi.mock("@/lib/seed-utils", () => ({ demoCredentials: { email: "demo@x.test", password: "pw" } }));

import { POST } from "@/app/api/seed/route";

beforeEach(() => {
	m.seedDemoData.mockReset();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("POST /api/seed", () => {
	it("returns 403 in production", async () => {
		vi.stubEnv("NODE_ENV", "production");
		const res = await POST();
		expect(res.status).toBe(403);
		expect((await res.json()) as any).toEqual({ error: "Not available in production" });
		expect(m.seedDemoData).not.toHaveBeenCalled();
	});

	it("seeds demo data outside production", async () => {
		vi.stubEnv("NODE_ENV", "development");
		m.seedDemoData.mockResolvedValue({ users: 1 });
		const res = await POST();
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			ok: true,
			credentials: { email: "demo@x.test", password: "pw" },
			seeded: { users: 1 },
		});
	});
});
