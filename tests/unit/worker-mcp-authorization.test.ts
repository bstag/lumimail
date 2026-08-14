import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	user: vi.fn(), recent: vi.fn(), inspect: vi.fn(), deny: vi.fn(), approve: vi.fn(),
	rate: vi.fn(), enforce: vi.fn(), id: vi.fn(() => "req_fixed"),
}));
vi.mock("@/lib/auth/session", () => ({ SESSION_COOKIE: "ep_session", getUserFromSession: h.user }));
vi.mock("@/lib/auth/recent-auth", () => ({ readRecentlyAuthenticatedSession: h.recent }));
vi.mock("@/lib/ids", () => ({ newId: h.id }));
vi.mock("@/lib/mcp/connections", () => ({
	inspectMcpAuthorization: h.inspect, denyMcpAuthorization: h.deny, approveMcpConnection: h.approve,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitUser: h.rate, enforceRateLimit: h.enforce }));

import { handleMcpAuthorizationRequest } from "../../worker-mcp-authorization";

const origin = "https://mail.example";
const query = "?client_id=client_1&response_type=code";
const env = { PUBLIC_APP_URL: origin, OAUTH_PROVIDER: {} } as never;

beforeEach(() => {
	vi.clearAllMocks();
	h.user.mockResolvedValue({ id: "usr_1", organizationId: "org_1" });
	h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
	h.inspect.mockResolvedValue({ clientName: "Agent", requestedScopes: ["mail.read"], defaultProfile: "read" });
	h.deny.mockResolvedValue({ redirectTo: "http://127.0.0.1/callback?error=access_denied" });
	h.approve.mockResolvedValue({ redirectTo: "http://127.0.0.1/callback?code=opaque" });
	h.rate.mockReturnValue(Promise.resolve({ allowed: true, remaining: 1 }));
	h.enforce.mockResolvedValue(null);
});

describe("outer Worker MCP authorization API", () => {
	it("authenticates and parses GET authorization in the native Worker realm", async () => {
		const response = await handleMcpAuthorizationRequest(new Request(
			`${origin}/api/mcp/authorization?authorizationQuery=${encodeURIComponent(query)}`,
			{ headers: { authorization: "Bearer session-token" } },
		), env);
		expect(response.status).toBe(200);
		expect(h.user).toHaveBeenCalledWith(env, "session-token");
		expect(h.inspect).toHaveBeenCalledWith(env, expect.objectContaining({ url: `${origin}/oauth/authorize${query}` }));
	});

	it("approves only same-origin, recently authenticated organization sessions", async () => {
		const response = await handleMcpAuthorizationRequest(new Request(`${origin}/api/mcp/authorization`, {
			method: "POST", headers: { authorization: "Bearer session-token", origin, "content-type": "application/json" },
			body: JSON.stringify({ authorizationQuery: query, decision: "approve", profile: "actions" }),
		}), env);
		expect(response.status).toBe(201);
		expect(h.approve).toHaveBeenCalledWith(env, expect.objectContaining({
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_1", profile: "actions", requestId: "req_fixed",
		}));
	});

	it("supports cookie authentication and provider-validated denial", async () => {
		const response = await handleMcpAuthorizationRequest(new Request(`${origin}/api/mcp/authorization`, {
			method: "POST", headers: { cookie: "other=x; ep_session=cookie-token", origin, "content-type": "application/json" },
			body: JSON.stringify({ authorizationQuery: query, decision: "deny" }),
		}), env);
		expect(response.status).toBe(200);
		expect(h.user).toHaveBeenCalledWith(env, "cookie-token");
		expect(h.deny).toHaveBeenCalled();
	});

	it("fails closed for anonymous, cross-origin, stale, and unsupported requests", async () => {
		h.user.mockResolvedValueOnce(null);
		expect((await handleMcpAuthorizationRequest(new Request(`${origin}/api/mcp/authorization`), env)).status).toBe(401);
		expect((await handleMcpAuthorizationRequest(new Request(`${origin}/api/mcp/authorization`, {
			method: "POST", headers: { authorization: "Bearer token", origin: "https://evil.example", "content-type": "application/json" }, body: "{}",
		}), env)).status).toBe(403);
		h.recent.mockResolvedValueOnce(null);
		expect((await handleMcpAuthorizationRequest(new Request(`${origin}/api/mcp/authorization`, {
			method: "POST", headers: { authorization: "Bearer token", origin, "content-type": "application/json" },
			body: JSON.stringify({ authorizationQuery: query, decision: "approve", profile: "read" }),
		}), env)).status).toBe(403);
		expect((await handleMcpAuthorizationRequest(new Request(`${origin}/api/mcp/authorization`, {
			method: "PUT", headers: { authorization: "Bearer token" },
		}), env)).status).toBe(405);
	});
});
