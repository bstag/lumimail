import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgAdmin: vi.fn(),
	read: vi.fn(),
	env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgAdmin: h.guardOrgAdmin }));
vi.mock("@/lib/access-overview", () => ({ readAccessOverview: h.read }));

import { GET } from "@/app/api/admin/access-overview/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	vi.clearAllMocks();
	h.guardOrgAdmin.mockResolvedValue({
		orgUser: { id: "admin_1", organizationId: "org_1", role: "admin" },
		errorResponse: null,
	});
});

describe("GET /api/admin/access-overview", () => {
	it("rejects a regular member before reading organization access", async () => {
		h.guardOrgAdmin.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		const response = await GET(new Request("https://x.test/api/admin/access-overview"));
		expect(response.status).toBe(403);
		expect(h.read).not.toHaveBeenCalled();
	});

	it("returns the organization-scoped read model", async () => {
		const overview = { members: [], mailboxes: [] };
		h.read.mockResolvedValue(overview);
		const response = await GET(new Request("https://x.test/api/admin/access-overview"));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, data: overview });
		expect(h.read).toHaveBeenCalledWith(h.env, "org_1");
	});
});
