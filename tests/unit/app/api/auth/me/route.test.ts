import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	userHasMailboxes: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/user", () => ({ userHasMailboxes: m.userHasMailboxes }));

import { GET } from "@/app/api/auth/me/route";

beforeEach(() => {
	m.getCurrentUser.mockReset();
	m.userHasMailboxes.mockReset();
});

function req() {
	return new Request("https://x.test/api/auth/me");
}

describe("GET /api/auth/me", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await GET(req());
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({ error: "Unauthorized" });
	});

	it("returns the current user and mailbox flag", async () => {
		m.getCurrentUser.mockResolvedValue({
			id: "u1",
			email: "a@x.test",
			name: "Ada",
			resetEmail: "r@x.test",
		});
		m.userHasMailboxes.mockResolvedValue(true);
		const res = await GET(req());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			user: { id: "u1", email: "a@x.test", name: "Ada", resetEmail: "r@x.test" },
			hasMailboxes: true,
		});
	});
});
