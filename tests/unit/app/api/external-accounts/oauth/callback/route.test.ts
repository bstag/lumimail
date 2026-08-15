import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	cookie: "session-token" as string | undefined,
	recent: vi.fn(),
	complete: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/auth/recent-auth", () => ({ readRecentlyAuthenticatedSession: h.recent }));
vi.mock("@/lib/email/external/connections", () => ({ completeExternalOAuth: h.complete }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookie ? { value: h.cookie } : undefined,
})) }));

import { GET } from "@/app/api/external-accounts/oauth/callback/route";

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.cookie = "session-token";
	h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
	h.complete.mockResolvedValue({ status: "created", accountId: "exa_1", externalAddress: "user@example.com" });
});

describe("GET /api/external-accounts/oauth/callback", () => {
	it("completes an exact-session callback and redirects without credentials", async () => {
		const response = await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=state_1&code=code_1"));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://mail.example/settings/external-accounts?connected=exa_1");
		expect(h.complete).toHaveBeenCalledWith(h.env, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_1", state: "state_1", code: "code_1",
		});
	});

	it("rejects provider denial, malformed input, stale session, and invalid configuration safely", async () => {
		for (const query of ["?error=access_denied&error_description=secret", "?state=s", "?code=c", "?state=x&code=y&extra=z"]) {
			const response = await GET(new Request(`https://mail.example/api/external-accounts/oauth/callback${query}`));
			expect(response.status).toBe(303);
			expect(response.headers.get("location")).not.toContain("secret");
		}
		h.recent.mockResolvedValue(null);
		expect((await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=s&code=c"))).status).toBe(403);
		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
		h.user = { id: "usr_1", organizationId: null };
		expect((await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=s&code=c"))).status).toBe(403);
		h.user = { id: "usr_1", organizationId: "org_1" };
		h.env = {} as CloudflareEnv;
		expect((await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=s&code=c"))).status).toBe(503);
	});

	it.each([
		["invalid-state", "invalid"],
		["forbidden", "forbidden"],
		["conflict", "already-connected"],
	] as const)("maps %s completion without exposing provider details", async (status, expected) => {
		h.complete.mockResolvedValue({ status });
		const response = await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=s&code=c"));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(`https://mail.example/settings/external-accounts?error=${expected}`);
	});

	it("returns a bounded unavailable redirect when completion fails", async () => {
		h.complete.mockRejectedValue(new Error("provider response with secrets"));
		const response = await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=s&code=c"));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://mail.example/settings/external-accounts?error=unavailable");
	});
});
