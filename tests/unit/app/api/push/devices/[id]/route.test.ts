import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	cookie: "session-token" as string | undefined,
	rename: vi.fn(),
	revoke: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/push/devices", () => ({ renamePushDevice: h.rename, revokePushDevice: h.revoke }));
vi.mock("@/lib/ids", () => ({ newId: () => "req_fixed" }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => h.cookie ? { value: h.cookie } : undefined })) }));

import { DELETE, PATCH } from "@/app/api/push/devices/[id]/route";

const context = { params: Promise.resolve({ id: "pud_1" }) };
function request(method: "PATCH" | "DELETE", body?: unknown, origin = "https://mail.example") {
	return new Request("https://mail.example/api/push/devices/pud_1", {
		method, headers: { origin, ...(body ? { "content-type": "application/json" } : {}) },
		...(body ? { body: JSON.stringify(body) } : {}),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.cookie = "session-token";
	h.rename.mockResolvedValue({ status: "updated" });
	h.revoke.mockResolvedValue({ status: "revoked" });
});

describe("/api/push/devices/:id", () => {
	it("fails closed when configuration, origin, or organization is unavailable", async () => {
		h.env = {} as CloudflareEnv;
		expect((await PATCH(request("PATCH", { name: "Phone" }), context)).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		expect((await DELETE(request("DELETE", undefined, "https://evil.example"), context)).status).toBe(403);
		h.user = { id: "usr_1", organizationId: null };
		expect((await PATCH(request("PATCH", { name: "Phone" }), context)).status).toBe(403);
	});

	it("renames an owned device with a strict same-origin body", async () => {
		const response = await PATCH(request("PATCH", { name: " Phone " }), context);
		expect(response.status).toBe(200);
		expect(h.rename).toHaveBeenCalledWith(h.env, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			name: "Phone", requestId: "req_fixed",
		});
		expect((await PATCH(request("PATCH", { name: "Phone", endpoint: "secret" }), context)).status).toBe(400);
		expect((await PATCH(request("PATCH", { name: "Phone" }, "https://evil.example"), context)).status).toBe(403);
	});

	it("maps foreign rename and recent-auth revoke outcomes without leaking ownership", async () => {
		h.rename.mockResolvedValue({ status: "not-found" });
		expect((await PATCH(request("PATCH", { name: "Phone" }), context)).status).toBe(404);
		h.revoke.mockResolvedValue({ status: "recent-auth-required" });
		expect((await DELETE(request("DELETE"), context)).status).toBe(403);
		h.revoke.mockResolvedValue({ status: "not-found" });
		expect((await DELETE(request("DELETE"), context)).status).toBe(404);
	});

	it("revokes server delivery with the current cookie session", async () => {
		h.cookie = undefined;
		const response = await DELETE(request("DELETE"), context);
		expect(response.status).toBe(200);
		expect(h.revoke).toHaveBeenCalledWith(h.env, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			sessionToken: undefined, requestId: "req_fixed",
		});
	});
});
