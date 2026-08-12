import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({ guardOrgAdmin: vi.fn(), resend: vi.fn(), env: {} as CloudflareEnv }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: h.guardOrgAdmin }));
vi.mock("@/lib/organization-invitations", () => ({ resendOrganizationInvitation: h.resend }));

import { POST } from "@/app/api/org/invites/[identifier]/resend/route";

const request = new Request("https://x.test/api/org/invites/inv_1/resend", { method: "POST" });

beforeEach(() => {
	vi.clearAllMocks();
	h.guardOrgAdmin.mockResolvedValue({ orgUser: { organizationId: "org_1" }, errorResponse: null });
	h.resend.mockResolvedValue({ status: "resent", inviteId: "inv_1", token: "tok_1", deliveryStatus: "sent" });
});

describe("POST /api/org/invites/[id]/resend", () => {
	it("denies non-admins before invitation reads", async () => {
		h.guardOrgAdmin.mockResolvedValue({ orgUser: null, errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
		const response = await POST(request, { params: Promise.resolve({ identifier: "inv_1" }) });
		expect(response.status).toBe(403);
		expect(h.resend).not.toHaveBeenCalled();
	});

	it("derives organization scope and returns only the rotated plaintext token", async () => {
		const response = await POST(request, { params: Promise.resolve({ identifier: "inv_1" }) });
		expect(h.resend).toHaveBeenCalledWith(h.env, { organizationId: "org_1", inviteId: "inv_1" });
		expect(await response.json()).toEqual({
			success: true,
			data: { invite: { id: "inv_1", token: "tok_1", deliveryStatus: "sent" } },
		});
	});

	it("maps bounded missing, accepted, cooldown, and unavailable outcomes", async () => {
		for (const [status, expected] of [["not-found", 404], ["accepted", 409], ["rate-limited", 429], ["unavailable", 503]] as const) {
			h.resend.mockResolvedValueOnce({ status });
			expect((await POST(request, { params: Promise.resolve({ identifier: "inv_1" }) })).status).toBe(expected);
		}
	});

	it("bounds an unexpected resend service failure", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		h.resend.mockRejectedValueOnce(new Error("database secret detail"));
		const response = await POST(request, { params: Promise.resolve({ identifier: "inv_1" }) });
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ success: false, error: { message: "Invitation service temporarily unavailable" } });
		expect(error).toHaveBeenCalledWith(JSON.stringify({ message: "organization invitation resend failed" }));
		error.mockRestore();
	});
});
