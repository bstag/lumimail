import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(), getBearerToken: vi.fn(), record: vi.fn(),
	cookieValue: undefined as string | undefined, env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/auth/cookies", () => ({ getBearerToken: h.getBearerToken }));
vi.mock("@/lib/operational-evidence", () => ({ recordOperationalEvidence: h.record }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookieValue === undefined ? undefined : { value: h.cookieValue },
})) }));

import { POST } from "@/app/api/admin/operations/evidence/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const body = { format: "lumimail-operations-evidence-v1", category: "smoke", outcome: "passed",
	passedChecks: 6, totalChecks: 6, observedAt: "2026-08-12T22:00:00.000Z" };
function request(value: unknown = body) {
	return new Request("https://x.test/api/admin/operations/evidence", {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
	});
}

beforeEach(() => {
	vi.clearAllMocks(); h.cookieValue = "cookie-token"; h.getBearerToken.mockReturnValue(undefined);
	h.guardOrgOwner.mockResolvedValue({ orgUser: { id: "usr_owner", organizationId: "org_1", role: "owner" }, errorResponse: null });
	h.record.mockResolvedValue({ status: "recorded" });
});

describe("POST /api/admin/operations/evidence", () => {
	it("denies non-owners before credential or evidence work", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		const response = await POST(request());
		expect(response.status).toBe(403); expect(h.getBearerToken).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
	});

	it("rejects unknown fields and inconsistent bounded counts", async () => {
		for (const value of [
			{ ...body, detail: "private" }, { ...body, passedChecks: 5 },
			{ ...body, passedChecks: 7 }, { ...body, outcome: "failed" }, { ...body, totalChecks: 1001 },
		]) expect((await POST(request(value))).status).toBe(400);
		expect(h.record).not.toHaveBeenCalled();
	});

	it("prefers bearer authentication and returns content-free creation", async () => {
		h.getBearerToken.mockReturnValue("bearer-token");
		const response = await POST(request());
		expect(response.status).toBe(201);
		expect(h.record).toHaveBeenCalledWith(h.env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "bearer-token",
			category: "smoke", outcome: "passed", passedChecks: 6, totalChecks: 6,
			observedAt: new Date("2026-08-12T22:00:00.000Z"),
		});
		expect(await response.json()).toEqual({ success: true, data: { recorded: true, duplicate: false } });
	});

	it("maps recent-auth, invalid, duplicate, conflict, and storage outcomes", async () => {
		for (const [status, expected] of [
			["recent-auth-required", 403], ["invalid", 400], ["conflict", 409],
		] as const) {
			h.record.mockResolvedValueOnce({ status });
			expect((await POST(request())).status).toBe(expected);
		}
		h.record.mockResolvedValueOnce({ status: "duplicate" });
		const duplicate = await POST(request());
		expect(duplicate.status).toBe(200);
		expect(await duplicate.json()).toEqual({ success: true, data: { recorded: true, duplicate: true } });

		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		h.record.mockRejectedValueOnce(new Error("private D1 detail"));
		const failed = await POST(request());
		expect(failed.status).toBe(500);
		expect(await failed.json()).toEqual({ success: false, error: { message: "Evidence could not be recorded" } });
		error.mockRestore();
	});
});
