import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	markMessageAsRead: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/user", () => ({ markMessageAsRead: m.markMessageAsRead }));

import { POST } from "@/app/api/messages/[messageId]/read/route";

beforeEach(() => {
	m.getCurrentUser.mockReset();
	m.markMessageAsRead.mockReset();
});

function post(messageId = "m1") {
	return POST(new Request("https://x.test/api/messages/m1/read", { method: "POST" }), {
		params: Promise.resolve({ messageId }),
	});
}

describe("POST /api/messages/[messageId]/read", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await post();
		expect(res.status).toBe(401);
	});

	it("returns 404 when the message is not found (cross-tenant denial)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.markMessageAsRead.mockResolvedValue(false);
		const res = await post();
		expect(res.status).toBe(404);
		expect(m.markMessageAsRead).toHaveBeenCalledWith({}, "u1", "m1");
	});

	it("marks the message as read", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.markMessageAsRead.mockResolvedValue(true);
		const res = await post();
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true });
	});
});
