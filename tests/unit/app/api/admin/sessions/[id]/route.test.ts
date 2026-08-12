import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(), getBearerToken: vi.fn(), revoke: vi.fn(),
	cookieValue: undefined as string | undefined, env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/auth/cookies", () => ({ getBearerToken: h.getBearerToken }));
vi.mock("@/lib/session-revocation", () => ({ revokeOrganizationSession: h.revoke }));
vi.mock("@/lib/ids", () => ({ newId: () => "req_fixed" }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookieValue === undefined ? undefined : { value: h.cookieValue },
})) }));

import { DELETE } from "@/app/api/admin/sessions/[id]/route";

const context = (id = "sess_target") => ({ params: Promise.resolve({ id }) });
const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	vi.clearAllMocks();
	h.cookieValue = "cookie-token";
	h.getBearerToken.mockReturnValue(undefined);
	h.guardOrgOwner.mockResolvedValue({
		orgUser: { id: "usr_owner", organizationId: "org_1", role: "owner" }, errorResponse: null,
	});
	h.revoke.mockResolvedValue({ status: "revoked", revokedCount: 1, requestId: "req_fixed" });
});

describe("DELETE /api/admin/sessions/[id]", () => {
	it("denies non-owners before credential reads or mutation", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		const response = await DELETE(new Request("https://x.test/api/admin/sessions/sess_target"), context());
		expect(response.status).toBe(403);
		expect(h.getBearerToken).not.toHaveBeenCalled();
		expect(h.revoke).not.toHaveBeenCalled();
	});

	it("uses bearer before cookie and returns content-free success metadata", async () => {
		h.getBearerToken.mockReturnValue("bearer-token");
		const response = await DELETE(new Request("https://x.test/api/admin/sessions/sess_target"), context());
		expect(h.revoke).toHaveBeenCalledWith(h.env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "bearer-token",
			targetSessionId: "sess_target", requestId: "req_fixed",
		});
		expect(await response.json()).toEqual({ success: true, data: { revokedCount: 1, requestId: "req_fixed" } });
	});

	it.each([
		[{ status: "recent-auth-required" }, 403, "Recent authentication required"],
		[{ status: "not-found" }, 404, "Session not found"],
		[{ status: "current-session" }, 409, "Use logout to end the current session"],
	] as const)("maps bounded service outcomes", async (result, status, message) => {
		h.revoke.mockResolvedValue(result);
		const response = await DELETE(new Request("https://x.test/api/admin/sessions/sess_target"), context());
		expect(response.status).toBe(status);
		expect(await response.json()).toEqual({ success: false, error: { message } });
	});
});
