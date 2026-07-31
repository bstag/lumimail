import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	seedDemoData: vi.fn(),
	env: {} as Record<string, unknown>,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => m.env }));
vi.mock("@/lib/seed", () => ({ seedDemoData: m.seedDemoData }));
vi.mock("@/lib/seed-fixtures", () => ({ demoCredentials: { email: "demo@x.test", password: "pw" } }));

import { POST } from "@/app/api/seed/route";

beforeEach(() => {
	m.seedDemoData.mockReset();
	m.env = { SEED_ENABLED: "true" };
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("POST /api/seed", () => {
	it("returns 403 in production even when SEED_ENABLED is set", async () => {
		vi.stubEnv("NODE_ENV", "production");
		const res = await POST();
		expect(res.status).toBe(403);
		expect((await res.json()) as any).toEqual({ error: "Not available in production" });
		expect(m.seedDemoData).not.toHaveBeenCalled();
	});

	it("fails closed when SEED_ENABLED is unset", async () => {
		vi.stubEnv("NODE_ENV", "development");
		m.env = {};
		const res = await POST();
		expect(res.status).toBe(403);
		expect((await res.json()) as any).toEqual({
			error: "Seeding is disabled. Set the SEED_ENABLED=\"true\" environment binding to enable it.",
		});
		expect(m.seedDemoData).not.toHaveBeenCalled();
	});

	it("rejects any SEED_ENABLED value other than the literal \"true\"", async () => {
		vi.stubEnv("NODE_ENV", "development");
		m.env = { SEED_ENABLED: "1" };
		const res = await POST();
		expect(res.status).toBe(403);
		expect(m.seedDemoData).not.toHaveBeenCalled();
	});

	it("seeds demo data outside production when explicitly enabled", async () => {
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
