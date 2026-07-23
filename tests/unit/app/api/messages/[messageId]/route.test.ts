import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	getMessageWithBody: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/email/inbound", () => ({ getMessageWithBody: m.getMessageWithBody }));

import { GET } from "@/app/api/messages/[messageId]/route";

beforeEach(() => {
	m.getCurrentUser.mockReset();
	m.getMessageWithBody.mockReset();
});

function get(messageId = "m1") {
	return GET(new Request("https://x.test/api/messages/m1"), {
		params: Promise.resolve({ messageId }),
	});
}

describe("GET /api/messages/[messageId]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(401);
	});

	it("returns 404 when the message is not found (cross-tenant denial)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMessageWithBody.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(404);
		expect(m.getMessageWithBody).toHaveBeenCalledWith({}, "u1", "o1", "m1");
	});

	it("returns the message with body", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "o1" });
		m.getMessageWithBody.mockResolvedValue({ id: "m1", textBody: "hi" });
		const res = await get();
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ id: "m1", textBody: "hi" });
	});
});
