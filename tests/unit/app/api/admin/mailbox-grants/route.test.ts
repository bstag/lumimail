import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(),
	getBearerToken: vi.fn(),
	grant: vi.fn(),
	cookieValue: undefined as string | undefined,
	env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/auth/cookies", () => ({ getBearerToken: h.getBearerToken }));
vi.mock("@/lib/bulk-mailbox-grants", () => ({ grantMailboxAccessBulk: h.grant }));
vi.mock("@/lib/ids", () => ({ newId: () => "req_fixed" }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookieValue === undefined ? undefined : { value: h.cookieValue },
})) }));

import { POST } from "@/app/api/admin/mailbox-grants/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const body = { targetUserId: "usr_member", mailboxIds: ["mbx_1", "mbx_2"], role: "responder" };
const request = (value: unknown = body) => new Request("https://x.test/api/admin/mailbox-grants", {
	method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
});

beforeEach(() => {
	vi.clearAllMocks();
	h.cookieValue = "cookie-token";
	h.getBearerToken.mockReturnValue(undefined);
	h.guardOrgOwner.mockResolvedValue({
		orgUser: { id: "usr_owner", organizationId: "org_1", role: "owner" }, errorResponse: null,
	});
	h.grant.mockResolvedValue({ status: "granted", createdCount: 2, requestId: "req_fixed" });
});

describe("POST /api/admin/mailbox-grants", () => {
	it("denies non-owners before credential reads or mutation", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		const response = await POST(request());
		expect(response.status).toBe(403);
		expect(h.getBearerToken).not.toHaveBeenCalled();
		expect(h.grant).not.toHaveBeenCalled();
	});

	it("rejects malformed, duplicate, and oversized input before credential or target reads", async () => {
		for (const invalid of [
			{ ...body, mailboxIds: [] },
			{ ...body, mailboxIds: ["mbx_1", "mbx_1"] },
			{ ...body, mailboxIds: Array.from({ length: 26 }, (_, index) => `mbx_${index}`) },
			{ ...body, role: "owner" },
		]) {
			const response = await POST(request(invalid));
			expect(response.status).toBe(400);
		}
		expect(h.getBearerToken).not.toHaveBeenCalled();
		expect(h.grant).not.toHaveBeenCalled();
	});

	it("uses bearer before cookie and returns content-free success metadata", async () => {
		h.getBearerToken.mockReturnValue("bearer-token");
		const response = await POST(request());
		expect(h.grant).toHaveBeenCalledWith(h.env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "bearer-token",
			targetUserId: "usr_member", mailboxIds: ["mbx_1", "mbx_2"], role: "responder",
			requestId: "req_fixed",
		});
		expect(await response.json()).toEqual({ success: true, data: { createdCount: 2, requestId: "req_fixed" } });
	});

	it("falls back to the cookie and maps bounded service outcomes", async () => {
		h.grant.mockResolvedValueOnce({ status: "recent-auth-required" });
		let response = await POST(request());
		expect(response.status).toBe(403);
		expect(h.grant).toHaveBeenCalledWith(h.env, expect.objectContaining({ currentToken: "cookie-token" }));

		h.grant.mockResolvedValueOnce({ status: "not-found" });
		response = await POST(request());
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ success: false, error: { message: "Member or mailbox not found" } });
	});

	it("returns a bounded failure when the atomic D1 batch rejects", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		h.grant.mockRejectedValueOnce(new Error("D1 conflict"));
		const response = await POST(request());
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ success: false, error: { message: "Bulk grant failed" } });
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});
