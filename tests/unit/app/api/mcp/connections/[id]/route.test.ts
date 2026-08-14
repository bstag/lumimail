import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	cookie: "session-token" as string | undefined,
	recent: vi.fn(),
	revoke: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/auth/recent-auth", () => ({ readRecentlyAuthenticatedSession: h.recent }));
vi.mock("@/lib/mcp/connections", () => ({ revokeMcpConnection: h.revoke }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => h.cookie ? { value: h.cookie } : undefined })) }));
vi.mock("@/lib/ids", () => ({ newId: () => "req_1" }));

import { DELETE } from "@/app/api/mcp/connections/[id]/route";

function request(origin = "https://mail.example") {
	return new Request("https://mail.example/api/mcp/connections/mcp_1", { method: "DELETE", headers: { origin } });
}
const context = { params: Promise.resolve({ id: "mcp_1" }) };

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.cookie = "session-token";
	h.recent.mockResolvedValue({ id: "sess_current", organizationId: "org_1" });
	h.revoke.mockResolvedValue({ status: "revoked" });
});

describe("DELETE /api/mcp/connections/:id", () => {
	it("requires configured same-origin recent authentication", async () => {
		h.env = {} as CloudflareEnv;
		expect((await DELETE(request(), context)).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		expect((await DELETE(request("https://evil.example"), context)).status).toBe(403);
		h.user = { id: "usr_1", organizationId: null };
		expect((await DELETE(request(), context)).status).toBe(403);
		h.user = { id: "usr_1", organizationId: "org_1" };
		h.recent.mockResolvedValue(null);
		expect((await DELETE(request(), context)).status).toBe(403);
	});

	it("revokes an owned connection and maps absent/provider failure", async () => {
		expect((await DELETE(request(), context)).status).toBe(200);
		expect(h.revoke).toHaveBeenCalledWith(h.env, expect.objectContaining({ connectionId: "mcp_1", userId: "usr_1", requestId: "req_1" }));
		h.revoke.mockResolvedValue({ status: "not-found" });
		expect((await DELETE(request(), context)).status).toBe(404);
		h.revoke.mockRejectedValue(new Error("provider"));
		expect((await DELETE(request(), context)).status).toBe(503);
	});
});
