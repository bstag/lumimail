import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	getBearerToken: vi.fn(),
	reconfirmSession: vi.fn(),
	enforceRateLimit: vi.fn(),
	rateLimitUser: vi.fn(),
	cookieValue: undefined as string | undefined,
	env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({
	getCurrentUser: h.getCurrentUser,
	getBearerToken: h.getBearerToken,
}));
vi.mock("@/lib/auth/recent-auth", () => ({ reconfirmSession: h.reconfirmSession }));
vi.mock("@/lib/rate-limit", () => ({
	enforceRateLimit: h.enforceRateLimit,
	rateLimitUser: h.rateLimitUser,
}));
vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: () => h.cookieValue === undefined ? undefined : { value: h.cookieValue },
	})),
}));

import { POST } from "@/app/api/auth/reconfirm/route";

function request(body: unknown, authorization?: string) {
	return new Request("https://x.test/api/auth/reconfirm", {
		method: "POST",
		headers: authorization ? { Authorization: authorization } : undefined,
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	h.cookieValue = "cookie-token";
	h.getCurrentUser.mockResolvedValue({ id: "usr_1" });
	h.getBearerToken.mockReturnValue(undefined);
	h.rateLimitUser.mockReturnValue(Promise.resolve({ allowed: true, remaining: 4 }));
	h.enforceRateLimit.mockResolvedValue(null);
	h.reconfirmSession.mockResolvedValue({
		confirmed: true,
		recentUntil: new Date("2026-08-12T20:15:00.000Z"),
	});
});

describe("POST /api/auth/reconfirm", () => {
	it("requires an authenticated user", async () => {
		h.getCurrentUser.mockResolvedValue(null);
		const response = await POST(request({ password: "secret" }));
		expect(response.status).toBe(401);
		expect(h.enforceRateLimit).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON and an empty password before rate limiting", async () => {
		const malformed = await POST(request("{"));
		expect(malformed.status).toBe(400);
		const empty = await POST(request({ password: "" }));
		expect(empty.status).toBe(400);
		expect(h.enforceRateLimit).not.toHaveBeenCalled();
	});

	it("fails closed when the durable limiter returns a response", async () => {
		h.enforceRateLimit.mockImplementation(async (_check, options) =>
			options.respond("Service temporarily unavailable", 503));
		const response = await POST(request({ password: "secret" }));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			success: false,
			error: { message: "Service temporarily unavailable" },
		});
		expect(h.reconfirmSession).not.toHaveBeenCalled();
	});

	it("uses bearer before cookie and returns the freshness expiry", async () => {
		h.getBearerToken.mockReturnValue("bearer-token");
		const response = await POST(request({ password: "secret" }, "Bearer bearer-token"));
		expect(response.status).toBe(200);
		expect(h.reconfirmSession).toHaveBeenCalledWith(h.env, "usr_1", "bearer-token", "secret");
		expect(await response.json()).toEqual({ success: true, data: { recentUntil: "2026-08-12T20:15:00.000Z" } });
	});

	it("falls back to the cookie and returns one bounded 403 on failure", async () => {
		h.reconfirmSession.mockResolvedValue({ confirmed: false });
		const response = await POST(request({ password: "wrong" }));
		expect(response.status).toBe(403);
		expect(h.reconfirmSession).toHaveBeenCalledWith(h.env, "usr_1", "cookie-token", "wrong");
		expect(await response.json()).toEqual({ success: false, error: { message: "Password confirmation failed" } });
	});
});
