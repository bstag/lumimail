import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: {} as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	resolve: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/push/resolver", () => ({ resolvePushNotification: h.resolve }));

import { GET } from "@/app/notifications/[deliveryId]/route";

const context = { params: Promise.resolve({ deliveryId: "pudl_0123456789ABCDEFGHIJK" }) };

beforeEach(() => {
	vi.clearAllMocks();
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.resolve.mockResolvedValue({ messageId: "msg_1" });
});

describe("GET /notifications/:deliveryId", () => {
	it("sends unauthenticated clicks through login without exposing a message route", async () => {
		h.user = null;
		const response = await GET(new Request("https://mail.example/notifications/pudl_0123456789ABCDEFGHIJK"), context);
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://mail.example/login");
		expect(h.resolve).not.toHaveBeenCalled();
	});

	it("redirects an authorized click to the inbox message", async () => {
		const response = await GET(new Request("https://mail.example/notifications/pudl_0123456789ABCDEFGHIJK"), context);
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://mail.example/inbox/msg_1");
		expect(h.resolve).toHaveBeenCalledWith(h.env, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", userId: "usr_1", organizationId: "org_1",
		});
	});

	it("returns indistinguishable 404s for malformed, foreign, and revoked deliveries", async () => {
		h.resolve.mockResolvedValue(null);
		expect((await GET(new Request("https://mail.example/notifications/pudl_0123456789ABCDEFGHIJK"), context)).status).toBe(404);
		expect((await GET(new Request("https://mail.example/notifications/bad"), {
			params: Promise.resolve({ deliveryId: "bad" }),
		})).status).toBe(404);
	});
});
