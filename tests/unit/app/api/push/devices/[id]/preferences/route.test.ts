import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	replace: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/push/devices", () => ({ replacePushDevicePreferences: h.replace }));
vi.mock("@/lib/ids", () => ({ newId: () => "req_fixed" }));

import { PUT } from "@/app/api/push/devices/[id]/preferences/route";

const context = { params: Promise.resolve({ id: "pud_1" }) };
function request(body: unknown, origin = "https://mail.example") {
	return new Request("https://mail.example/api/push/devices/pud_1/preferences", {
		method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.replace.mockResolvedValue({ status: "updated", mailboxIds: ["mbx_1"] });
});

describe("PUT /api/push/devices/:id/preferences", () => {
	it("fails closed without configuration or an active organization", async () => {
		h.env = {} as CloudflareEnv;
		expect((await PUT(request({ mailboxIds: [] }), context)).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		h.user = { id: "usr_1", organizationId: null };
		expect((await PUT(request({ mailboxIds: [] }), context)).status).toBe(403);
	});

	it("replaces a bounded explicit mailbox list", async () => {
		const response = await PUT(request({ mailboxIds: ["mbx_1"] }), context);
		expect(response.status).toBe(200);
		expect(h.replace).toHaveBeenCalledWith(h.env, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			mailboxIds: ["mbx_1"], requestId: "req_fixed",
		});
	});

	it("rejects duplicate, foreign, absent, and cross-origin requests", async () => {
		expect((await PUT(request({ mailboxIds: ["mbx_1", "mbx_1"] }), context)).status).toBe(400);
		expect((await PUT(request({ mailboxIds: [] }, "https://evil.example"), context)).status).toBe(403);
		h.replace.mockResolvedValue({ status: "forbidden-mailbox" });
		expect((await PUT(request({ mailboxIds: ["mbx_foreign"] }), context)).status).toBe(404);
		h.replace.mockResolvedValue({ status: "not-found" });
		expect((await PUT(request({ mailboxIds: [] }), context)).status).toBe(404);
	});
});
