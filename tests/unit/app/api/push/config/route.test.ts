import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: {} as CloudflareEnv & { VAPID_PUBLIC_KEY?: string },
	user: { id: "usr_1" } as any,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));

import { GET } from "@/app/api/push/config/route";

beforeEach(() => {
	h.env = {} as typeof h.env;
	h.user = { id: "usr_1" };
});

describe("GET /api/push/config", () => {
	it("returns only availability and the public VAPID key", async () => {
		h.env = {
			VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`,
			VAPID_PRIVATE_KEY: "must-not-leak",
			VAPID_SUBJECT: "mailto:operator@example.com",
		} as unknown as typeof h.env;
		const response = await GET(new Request("https://mail.example/api/push/config"));
		expect(await response.json()).toEqual({ success: true, data: {
			available: true,
			vapidPublicKey: `B${"A".repeat(86)}`,
		} });
	});

	it("fails closed without a valid public key and requires authentication", async () => {
		let response = await GET(new Request("https://mail.example/api/push/config"));
		expect(await response.json()).toEqual({ success: true, data: { available: false, vapidPublicKey: null } });
		h.env.VAPID_PUBLIC_KEY = "bad";
		response = await GET(new Request("https://mail.example/api/push/config"));
		expect(await response.json()).toEqual({ success: true, data: { available: false, vapidPublicKey: null } });
		h.user = null;
		expect((await GET(new Request("https://mail.example/api/push/config"))).status).toBe(401);
	});
});
