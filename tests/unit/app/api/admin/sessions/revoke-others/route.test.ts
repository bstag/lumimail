import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(), getBearerToken: vi.fn(), revoke: vi.fn(),
	cookieValue: undefined as string | undefined, env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/auth/cookies", () => ({ getBearerToken: h.getBearerToken }));
vi.mock("@/lib/session-revocation", () => ({ revokeOtherOrganizationSessions: h.revoke }));
vi.mock("@/lib/ids", () => ({ newId: () => "req_fixed" }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookieValue === undefined ? undefined : { value: h.cookieValue },
})) }));

import { POST } from "@/app/api/admin/sessions/revoke-others/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	vi.clearAllMocks();
	h.cookieValue = "cookie-token";
	h.getBearerToken.mockReturnValue(undefined);
	h.guardOrgOwner.mockResolvedValue({
		orgUser: { id: "usr_owner", organizationId: "org_1", role: "owner" }, errorResponse: null,
	});
	h.revoke.mockResolvedValue({ status: "revoked", revokedCount: 3, requestId: "req_fixed" });
});

describe("POST /api/admin/sessions/revoke-others", () => {
	it("denies non-owners before mutation", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		const response = await POST(new Request("https://x.test/api/admin/sessions/revoke-others", { method: "POST" }));
		expect(response.status).toBe(403);
		expect(h.revoke).not.toHaveBeenCalled();
	});

	it("uses the cookie fallback and returns the affected count", async () => {
		const response = await POST(new Request("https://x.test/api/admin/sessions/revoke-others", { method: "POST" }));
		expect(h.revoke).toHaveBeenCalledWith(h.env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "cookie-token", requestId: "req_fixed",
		});
		expect(await response.json()).toEqual({ success: true, data: { revokedCount: 3, requestId: "req_fixed" } });
	});

	it("uses a bearer credential before the cookie", async () => {
		h.getBearerToken.mockReturnValue("bearer-token");
		await POST(new Request("https://x.test/api/admin/sessions/revoke-others", { method: "POST" }));
		expect(h.revoke).toHaveBeenCalledWith(h.env, expect.objectContaining({ currentToken: "bearer-token" }));
	});

	it("fails closed when the exact session is not recent", async () => {
		h.revoke.mockResolvedValue({ status: "recent-auth-required" });
		const response = await POST(new Request("https://x.test/api/admin/sessions/revoke-others", { method: "POST" }));
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ success: false, error: { message: "Recent authentication required" } });
	});
});
