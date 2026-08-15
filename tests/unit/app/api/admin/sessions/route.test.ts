import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
	guardOrgOwner: vi.fn(),
	read: vi.fn(),
	getBearerToken: vi.fn(),
	cookieValue: undefined as string | undefined,
	env: {} as CloudflareEnv,
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/org-guard", () => ({ guardOrgOwner: h.guardOrgOwner }));
vi.mock("@/lib/auth/cookies", () => ({ getBearerToken: h.getBearerToken }));
vi.mock("@/lib/session-overview", () => ({ readSessionOverview: h.read }));
vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: () => h.cookieValue === undefined ? undefined : { value: h.cookieValue },
	})),
}));

import { cookies } from "next/headers";
import { GET } from "@/app/api/admin/sessions/route";

const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });

beforeEach(() => {
	vi.clearAllMocks();
	h.cookieValue = "cookie-token";
	h.guardOrgOwner.mockResolvedValue({
		orgUser: { id: "owner_1", organizationId: "org_1", role: "owner" },
		errorResponse: null,
	});
	h.read.mockResolvedValue({ observedAt: "2026-08-12T20:00:00.000Z", activeCount: 0, sessions: [] });
});

describe("GET /api/admin/sessions", () => {
	it("denies non-owners before reading cookies or sessions", async () => {
		h.guardOrgOwner.mockResolvedValue({ orgUser: null, errorResponse: forbidden });
		const response = await GET(new Request("https://x.test/api/admin/sessions"));
		expect(response.status).toBe(403);
		expect(cookies).not.toHaveBeenCalled();
		expect(h.read).not.toHaveBeenCalled();
	});

	it("uses the bearer credential before the session cookie", async () => {
		h.getBearerToken.mockReturnValue("bearer-token");
		const response = await GET(new Request("https://x.test/api/admin/sessions"));
		expect(response.status).toBe(200);
		expect(h.read).toHaveBeenCalledWith(h.env, "org_1", "bearer-token");
	});

	it("falls back to the cookie when no bearer credential is presented", async () => {
		h.getBearerToken.mockReturnValue(undefined);
		await GET(new Request("https://x.test/api/admin/sessions"));
		expect(h.read).toHaveBeenCalledWith(h.env, "org_1", "cookie-token");
	});

	it("supports a valid guarded request with no presented credential", async () => {
		h.getBearerToken.mockReturnValue(undefined);
		h.cookieValue = undefined;
		await GET(new Request("https://x.test/api/admin/sessions"));
		expect(h.read).toHaveBeenCalledWith(h.env, "org_1", undefined);
	});
});
