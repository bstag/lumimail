import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(), getBearerToken: vi.fn(), record: vi.fn(),
	cookieValue: undefined as string | undefined, env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/auth/cookies", () => ({ getBearerToken: h.getBearerToken }));
vi.mock("@/lib/mail-flow-evidence", () => ({ recordMailFlowEvidence: h.record }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookieValue === undefined ? undefined : { value: h.cookieValue },
})) }));

import { POST } from "@/app/api/admin/operations/evidence/mail-flow/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const body = {
	format: "lumimail-mail-flow-proof-v1",
	deliveredMessageId: "<outbound@example.com>",
	deliveredInReplyTo: "<inbound@example.com>",
	deliveredReferences: "<root@example.com> <inbound@example.com>",
	observedAt: "2026-08-13T12:00:00.000Z",
};
function request(value: unknown = body) {
	return new Request("https://x.test/api/admin/operations/evidence/mail-flow", {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
	});
}

beforeEach(() => {
	vi.clearAllMocks(); h.cookieValue = "cookie-token"; h.getBearerToken.mockReturnValue(undefined);
	h.guardOrgOwner.mockResolvedValue({ orgUser: { id: "usr_owner", organizationId: "org_1", role: "owner" }, errorResponse: null });
	h.record.mockResolvedValue({ status: "recorded", outcome: "passed", passedChecks: 8, totalChecks: 8 });
});

describe("POST mail-flow evidence proof", () => {
	it("denies non-owners before credential or proof work", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		expect((await POST(request())).status).toBe(403);
		expect(h.getBearerToken).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
	});

	it("rejects extra, malformed, and oversized proof fields", async () => {
		for (const value of [
			{ ...body, outcome: "passed" },
			{ ...body, deliveredMessageId: "not-an-rfc-id" },
			{ ...body, deliveredReferences: "x".repeat(2049) },
			{ ...body, observedAt: "not-a-date" },
		]) expect((await POST(request(value))).status).toBe(400);
		expect(h.record).not.toHaveBeenCalled();
	});

	it("prefers the bearer and returns only the derived result", async () => {
		h.getBearerToken.mockReturnValue("bearer-token");
		const response = await POST(request());
		expect(response.status).toBe(201);
		expect(h.record).toHaveBeenCalledWith(h.env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "bearer-token",
			deliveredMessageId: body.deliveredMessageId, deliveredInReplyTo: body.deliveredInReplyTo,
			deliveredReferences: body.deliveredReferences, observedAt: new Date(body.observedAt),
		});
		expect(await response.json()).toEqual({ success: true, data: {
			recorded: true, duplicate: false, outcome: "passed", passedChecks: 8, totalChecks: 8,
		} });
	});

	it("maps recent-auth, invalid, conflict, duplicate, and caught failures", async () => {
		for (const [status, expected] of [["recent-auth-required", 403], ["invalid", 400], ["conflict", 409]] as const) {
			h.record.mockResolvedValueOnce({ status });
			expect((await POST(request())).status).toBe(expected);
		}
		h.record.mockResolvedValueOnce({ status: "duplicate", outcome: "failed", passedChecks: 7, totalChecks: 8 });
		const duplicate = await POST(request());
		expect(duplicate.status).toBe(200);
		expect(await duplicate.json()).toEqual({ success: true, data: {
			recorded: true, duplicate: true, outcome: "failed", passedChecks: 7, totalChecks: 8,
		} });

		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		h.record.mockRejectedValueOnce(new Error("private trace detail"));
		const failed = await POST(request());
		expect(failed.status).toBe(500);
		expect(await failed.json()).toEqual({ success: false, error: { message: "Mail-flow evidence could not be recorded" } });
		error.mockRestore();
	});

	it("fails closed when the service omits any derived result field", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		for (const result of [
			{ status: "recorded" },
			{ status: "recorded", outcome: "passed" },
			{ status: "recorded", outcome: "passed", passedChecks: 8 },
		]) {
			h.record.mockResolvedValueOnce(result);
			expect((await POST(request())).status).toBe(500);
		}
		error.mockRestore();
	});
});
