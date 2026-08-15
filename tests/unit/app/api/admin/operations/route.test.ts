import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(),
	read: vi.fn(),
	env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/operations", () => ({ readOperationsOverview: h.read }));

import { GET } from "@/app/api/admin/operations/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const overview = { status: "healthy", observedAt: "2026-08-12T18:00:00.000Z" };

beforeEach(() => {
	vi.clearAllMocks();
	h.guardOrgOwner.mockResolvedValue({
		orgUser: { id: "owner_1", organizationId: "org_1", role: "owner" },
		errorResponse: null,
	});
});

describe("GET /api/admin/operations", () => {
	it("rejects non-owners before reading operational state", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		const response = await GET(new Request("https://x.test/api/admin/operations"));
		expect(response.status).toBe(403);
		expect(h.read).not.toHaveBeenCalled();
	});

	it("returns the sanitized read-only overview", async () => {
		h.read.mockResolvedValue(overview);
		const response = await GET(new Request("https://x.test/api/admin/operations"));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, data: overview });
		expect(h.read).toHaveBeenCalledWith(h.env, "org_1");
	});
});
