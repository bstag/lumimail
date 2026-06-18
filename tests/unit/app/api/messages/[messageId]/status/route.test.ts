import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	updateMessageStatus: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/user", () => ({ updateMessageStatus: m.updateMessageStatus }));

import { POST } from "@/app/api/messages/[messageId]/status/route";

beforeEach(() => {
	m.getCurrentUser.mockReset();
	m.updateMessageStatus.mockReset();
});

function post(body: unknown, messageId = "m1") {
	return POST(
		new Request("https://x.test/api/messages/m1/status", {
			method: "POST",
			body: JSON.stringify(body),
		}),
		{ params: Promise.resolve({ messageId }) },
	);
}

describe("POST /api/messages/[messageId]/status", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await post({ status: "sent" });
		expect(res.status).toBe(401);
	});

	it("returns 400 for a disallowed status", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await post({ status: "bogus" });
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ error: "Invalid message status" });
	});

	it("returns 404 when the message is not found (cross-tenant denial)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.updateMessageStatus.mockResolvedValue(false);
		const res = await post({ status: "trash" });
		expect(res.status).toBe(404);
		expect(m.updateMessageStatus).toHaveBeenCalledWith({}, "u1", "m1", "trash");
	});

	it("updates the message status", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.updateMessageStatus.mockResolvedValue(true);
		const res = await post({ status: "spam" });
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true });
	});
});
