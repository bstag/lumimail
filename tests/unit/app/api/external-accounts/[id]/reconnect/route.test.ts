import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	recent: vi.fn(),
	reconnect: vi.fn(),
	enforce: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "token" }) })) }));
vi.mock("@/lib/auth/recent-auth", () => ({ readRecentlyAuthenticatedSession: h.recent }));
vi.mock("@/lib/email/external/account-management", () => ({ beginExternalAccountReconnect: h.reconnect }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: h.enforce, rateLimitUser: vi.fn() }));

import { POST } from "@/app/api/external-accounts/[id]/reconnect/route";

const params = () => ({ params: Promise.resolve({ id: "exa_1" }) });
const request = (origin = "https://mail.example") => new Request(
	"https://mail.example/api/external-accounts/exa_1/reconnect", { method: "POST", headers: { origin } },
);

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
	h.enforce.mockResolvedValue(null);
	h.reconnect.mockResolvedValue({ status: "created", redirectTo: "https://provider.example" });
});

describe("POST /api/external-accounts/[id]/reconnect", () => {
	it("starts an exact-session bound reconnect", async () => {
		const response = await POST(request(), params());
		expect(response.status).toBe(201);
		expect(h.reconnect).toHaveBeenCalledWith(h.env, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_1", accountId: "exa_1",
		});
	});

	it("enforces origin, configured origin, organization, recent auth, and rate limiting", async () => {
		expect((await POST(request("https://evil.example"), params())).status).toBe(403);
		h.env = {} as CloudflareEnv;
		expect((await POST(request(), params())).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		h.user = { id: "usr_1", organizationId: null };
		expect((await POST(request(), params())).status).toBe(403);
		h.user = { id: "usr_1", organizationId: "org_1" };
		h.recent.mockResolvedValue(null);
		expect((await POST(request(), params())).status).toBe(403);
		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_other" });
		expect((await POST(request(), params())).status).toBe(403);
		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
		h.enforce.mockImplementation(async (_check, options) => options.respond("limited", 429));
		expect((await POST(request(), params())).status).toBe(429);
	});

	it("maps hidden and conflicting accounts", async () => {
		h.reconnect.mockResolvedValue({ status: "not-found" });
		expect((await POST(request(), params())).status).toBe(404);
		h.reconnect.mockResolvedValue({ status: "conflict" });
		expect((await POST(request(), params())).status).toBe(409);
	});
});
