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

	it.each([
		["Google", "?state=state_1&code=code_1&scope=email%20openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly&authuser=0&prompt=consent"],
		["Google Workspace", "?iss=https%3A%2F%2Faccounts.google.com&code=code_1&scope=email&state=state_1&authuser=1&hd=example.com&prompt=consent"],
		["Microsoft", "?code=code_1&state=state_1&session_state=0f1e2d3c-aaaa-bbbb-cccc-000000000000"],
	])("completes a %s callback and ignores provider-appended parameters", async (_provider, query) => {
		const response = await GET(new Request(`https://mail.example/api/external-accounts/oauth/callback${query}`));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://mail.example/settings/external-accounts?connected=exa_1");
		expect(h.complete).toHaveBeenCalledWith(h.env, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_1", state: "state_1", code: "code_1",
		});
	});

	it("redirects provider denial without echoing the provider description", async () => {
		const response = await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?error=access_denied&error_description=secret&state=s"));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://mail.example/settings/external-accounts?error=provider-denied");
		expect(h.complete).not.toHaveBeenCalled();
	});

	it.each([
		"?state=s",
		"?code=c",
		"?state=&code=c",
		"?state=a&state=b&code=c",
		"?state=s&code=a&code=b",
		`?state=${"s".repeat(257)}&code=c`,
	])("redirects malformed callback %s as invalid without completing", async (query) => {
		const response = await GET(new Request(`https://mail.example/api/external-accounts/oauth/callback${query}`));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://mail.example/settings/external-accounts?error=invalid");
		expect(h.complete).not.toHaveBeenCalled();
	});

	it("redirects stale recent authentication and missing organization instead of returning JSON", async () => {
		h.recent.mockResolvedValue(null);
		let response = await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=s&code=c"));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://mail.example/settings/external-accounts?error=reauthenticate");

		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_other" });
		response = await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=s&code=c"));
		expect(response.headers.get("location")).toBe("https://mail.example/settings/external-accounts?error=reauthenticate");

		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
		h.user = { id: "usr_1", organizationId: null };
		response = await GET(new Request("https://mail.example/api/external-accounts/oauth/callback?state=s&code=c"));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://mail.example/settings/external-accounts?error=forbidden");
		expect(h.complete).not.toHaveBeenCalled();
	});

	it("returns 503 when the public origin is not configured", async () => {
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
