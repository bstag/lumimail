import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: {} as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	list: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/email/external/account-management", () => ({ listExternalAccounts: h.list }));

import { GET } from "@/app/api/external-accounts/route";

beforeEach(() => {
	vi.clearAllMocks();
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.list.mockResolvedValue([{ id: "exa_1", externalAddress: "user@example.com" }]);
});

describe("GET /api/external-accounts", () => {
	it("returns a secret-free accessible collection", async () => {
		const response = await GET(new Request("https://mail.example/api/external-accounts"));
		expect(response.status).toBe(200);
		expect(((await response.json()) as any).data.accounts).toEqual([{ id: "exa_1", externalAddress: "user@example.com" }]);
		expect(h.list).toHaveBeenCalledWith(h.env, "usr_1", "org_1");
	});

	it("requires an active organization", async () => {
		h.user = { id: "usr_1", organizationId: null };
		expect((await GET(new Request("https://mail.example/api/external-accounts"))).status).toBe(403);
		expect(h.list).not.toHaveBeenCalled();
	});
});
