import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(),
	read: vi.fn(),
	env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/security-audit-history", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/security-audit-history")>();
	return { ...actual, readSecurityAuditHistory: h.read };
});

import { GET } from "@/app/api/admin/security-events/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	vi.clearAllMocks();
	h.guardOrgOwner.mockResolvedValue({
		orgUser: { id: "owner_1", organizationId: "org_1", role: "owner" },
		errorResponse: null,
	});
	h.read.mockResolvedValue({ events: [], nextCursor: null });
});

describe("GET /api/admin/security-events", () => {
	it("denies non-owners before reading audit history", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		const response = await GET(new Request("https://x.test/api/admin/security-events"));
		expect(response.status).toBe(403);
		expect(h.read).not.toHaveBeenCalled();
	});

	it("reads the first bounded organization page with defaults", async () => {
		const response = await GET(new Request("https://x.test/api/admin/security-events"));
		expect(response.status).toBe(200);
		expect(h.read).toHaveBeenCalledWith(h.env, "org_1", { limit: 20, cursor: null });
	});

	it("accepts the maximum page size and a valid cursor", async () => {
		const cursor = "m0.aud_1";
		const response = await GET(new Request(`https://x.test/api/admin/security-events?limit=50&cursor=${cursor}`));
		expect(response.status).toBe(200);
		expect(h.read).toHaveBeenCalledWith(h.env, "org_1", {
			limit: 50,
			cursor: { createdAt: new Date(0), id: "aud_1" },
		});
	});

	it.each([
		"?limit=0",
		"?limit=51",
		"?limit=nope",
		"?cursor=malformed",
	])("rejects invalid bounded navigation %s without a database read", async (query) => {
		const response = await GET(new Request(`https://x.test/api/admin/security-events${query}`));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ success: false, error: { message: "Invalid query" } });
		expect(h.read).not.toHaveBeenCalled();
	});
});
