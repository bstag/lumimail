import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	cookie: "session-token" as string | undefined,
	inspect: vi.fn(),
	approve: vi.fn(),
	deny: vi.fn(),
	recent: vi.fn(),
	rateLimit: vi.fn(),
	enforceLimit: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/auth/recent-auth", () => ({ readRecentlyAuthenticatedSession: h.recent }));
vi.mock("@/lib/mcp/connections", () => ({
	inspectMcpAuthorization: h.inspect,
	approveMcpConnection: h.approve,
	denyMcpAuthorization: h.deny,
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => h.cookie ? { value: h.cookie } : undefined })) }));
vi.mock("@/lib/ids", () => ({ newId: () => "req_1" }));
vi.mock("@/lib/rate-limit", () => ({
	rateLimitUser: h.rateLimit,
	enforceRateLimit: h.enforceLimit,
}));

import { GET, POST } from "@/app/api/mcp/authorization/route";

function getRequest(query = "?client_id=a") {
	return new Request(`https://mail.example/api/mcp/authorization?authorizationQuery=${encodeURIComponent(query)}`);
}

function postRequest(body: unknown, origin = "https://mail.example") {
	return new Request("https://mail.example/api/mcp/authorization", {
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
	h.inspect.mockResolvedValue({ clientName: "Agent", requestedScopes: ["mail.read"], defaultProfile: "read" });
	h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
	h.approve.mockResolvedValue({ redirectTo: "https://client.example/callback?code=x" });
	h.deny.mockResolvedValue({ redirectTo: "https://client.example/callback?error=access_denied" });
	h.rateLimit.mockResolvedValue({ allowed: true, remaining: 19 });
	h.enforceLimit.mockResolvedValue(null);
});

describe("/api/mcp/authorization", () => {
	it("returns a validated consent summary", async () => {
		const response = await GET(getRequest());
		expect(response.status).toBe(200);
		expect((await response.json() as { data: { defaultProfile: string } }).data.defaultProfile).toBe("read");
		expect(h.inspect).toHaveBeenCalledWith(h.env, expect.objectContaining({ url: "https://mail.example/oauth/authorize?client_id=a" }));
	});

	it("rejects missing configuration and malformed authorization queries", async () => {
		h.env = {} as CloudflareEnv;
		expect((await GET(getRequest())).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		expect((await GET(new Request("https://mail.example/api/mcp/authorization"))).status).toBe(400);
		h.inspect.mockRejectedValue(new Error("invalid"));
		expect((await GET(getRequest())).status).toBe(400);
	});

	it("requires same-origin, active organization, valid input, and recent exact session", async () => {
		expect((await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve", profile: "read" }, "https://evil.example"))).status).toBe(403);
		h.user = { id: "usr_1", organizationId: null };
		expect((await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve", profile: "read" }))).status).toBe(403);
		h.user = { id: "usr_1", organizationId: "org_1" };
		expect((await POST(postRequest({ profile: "read" }))).status).toBe(400);
		expect((await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve" }))).status).toBe(400);
		h.recent.mockResolvedValue(null);
		expect((await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve", profile: "read" }))).status).toBe(403);
		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_other" });
		expect((await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve", profile: "read" }))).status).toBe(403);
	});

	it("completes authorization only after recent authentication", async () => {
		const response = await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve", profile: "actions" }));
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ success: true, data: { redirectTo: "https://client.example/callback?code=x" } });
		expect(h.approve).toHaveBeenCalledWith(h.env, expect.objectContaining({
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_1", profile: "actions", requestId: "req_1",
		}));
	});

	it("fails closed when the per-user approval budget is exhausted", async () => {
		h.enforceLimit.mockImplementation(async (_check, options: { respond: (message: string, status: 429) => Response }) =>
			options.respond("Too many authorization approvals", 429));
		const response = await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve", profile: "read" }));
		expect(response.status).toBe(429);
		expect(h.approve).not.toHaveBeenCalled();
	});

	it("allows a signed-in user to deny without password reconfirmation", async () => {
		h.recent.mockResolvedValue(null);
		const response = await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "deny" }));
		expect(response.status).toBe(200);
		expect(h.deny).toHaveBeenCalledOnce();
		expect(h.approve).not.toHaveBeenCalled();
		h.deny.mockRejectedValue(new Error("invalid"));
		expect((await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "deny" }))).status).toBe(400);
	});

	it("bounds reconstruction and provider failures", async () => {
		expect((await POST(postRequest({ authorizationQuery: "bad", decision: "approve", profile: "read" }))).status).toBe(400);
		h.approve.mockRejectedValue(new Error("unavailable"));
		expect((await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve", profile: "read" }))).status).toBe(503);
		h.env = {} as CloudflareEnv;
		expect((await POST(postRequest({ authorizationQuery: "?client_id=a", decision: "approve", profile: "read" }))).status).toBe(503);
	});
});
