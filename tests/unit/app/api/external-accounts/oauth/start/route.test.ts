import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	cookie: "session-token" as string | undefined,
	recent: vi.fn(),
	begin: vi.fn(),
	rateLimit: vi.fn(),
	enforceLimit: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/auth/recent-auth", () => ({ readRecentlyAuthenticatedSession: h.recent }));
vi.mock("@/lib/email/external/connections", () => ({ beginExternalOAuth: h.begin }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookie ? { value: h.cookie } : undefined,
})) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitUser: h.rateLimit, enforceRateLimit: h.enforceLimit }));

import { POST } from "@/app/api/external-accounts/oauth/start/route";

const valid = {
	provider: "google",
	mailboxId: "mbx_1",
	importMode: "from_now",
	retainOriginal: false,
};

function request(body: unknown, origin = "https://mail.example") {
	return new Request("https://mail.example/api/external-accounts/oauth/start", {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.cookie = "session-token";
	h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
	h.begin.mockResolvedValue({ status: "created", redirectTo: "https://provider.example/auth" });
	h.enforceLimit.mockResolvedValue(null);
});

describe("POST /api/external-accounts/oauth/start", () => {
	it("requires configured same-origin recent exact-session authorization", async () => {
		expect((await POST(request(valid, "https://evil.example"))).status).toBe(403);
		h.env = {} as CloudflareEnv;
		expect((await POST(request(valid))).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		h.user = { id: "usr_1", organizationId: null };
		expect((await POST(request(valid))).status).toBe(403);
		h.user = { id: "usr_1", organizationId: "org_1" };
		h.recent.mockResolvedValue(null);
		expect((await POST(request(valid))).status).toBe(403);
		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_other" });
		expect((await POST(request(valid))).status).toBe(403);
	});

	it("strictly validates and starts a bounded provider flow", async () => {
		const response = await POST(request(valid));
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			success: true,
			data: { redirectTo: "https://provider.example/auth" },
		});
		expect(h.begin).toHaveBeenCalledWith(h.env, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_1", ...valid,
		});
		expect((await POST(request({ ...valid, refreshToken: "secret" }))).status).toBe(400);
	});

	it("maps capability, rate-limit, and unavailable outcomes", async () => {
		h.begin.mockResolvedValue({ status: "forbidden" });
		expect((await POST(request(valid))).status).toBe(404);
		h.enforceLimit.mockImplementation(async (_check, options: { respond: (message: string, status: 429) => Response }) =>
			options.respond("Too many external account connections", 429));
		expect((await POST(request(valid))).status).toBe(429);
		expect(h.begin).toHaveBeenCalledTimes(1);
		h.enforceLimit.mockResolvedValue(null);
		h.begin.mockRejectedValue(new Error("provider config"));
		expect((await POST(request(valid))).status).toBe(503);
	});
});
