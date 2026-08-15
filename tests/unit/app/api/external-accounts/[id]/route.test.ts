import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	cookie: "session-token" as string | undefined,
	recent: vi.fn(),
	get: vi.fn(),
	update: vi.fn(),
	disconnect: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/auth/recent-auth", () => ({ readRecentlyAuthenticatedSession: h.recent }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookie ? { value: h.cookie } : undefined,
})) }));
vi.mock("@/lib/email/external/account-management", () => ({
	getExternalAccount: h.get,
	updateExternalAccount: h.update,
	disconnectExternalAccount: h.disconnect,
}));

import { DELETE, GET, PATCH } from "@/app/api/external-accounts/[id]/route";

const params = () => ({ params: Promise.resolve({ id: "exa_1" }) });
function request(method: string, body?: unknown, origin = "https://mail.example") {
	return new Request("https://mail.example/api/external-accounts/exa_1", {
		method,
		headers: { origin, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.cookie = "session-token";
	h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
	h.get.mockResolvedValue({ id: "exa_1", externalAddress: "user@example.com" });
	h.update.mockResolvedValue({ status: "updated" });
	h.disconnect.mockResolvedValue({ status: "disconnected" });
});

describe("external account detail lifecycle route", () => {
	it("returns detail and preserves non-enumerating absence", async () => {
		expect((await GET(request("GET"), params())).status).toBe(200);
		h.get.mockResolvedValue(null);
		expect((await GET(request("GET"), params())).status).toBe(404);
		h.user = { id: "usr_1", organizationId: null };
		expect((await GET(request("GET"), params())).status).toBe(403);
	});

	it("pauses without recent auth but requires same-origin and valid input", async () => {
		h.recent.mockResolvedValue(null);
		expect((await PATCH(request("PATCH", { status: "paused" }), params())).status).toBe(200);
		expect(h.recent).not.toHaveBeenCalled();
		expect((await PATCH(request("PATCH", { status: "paused" }, "https://evil.example"), params())).status).toBe(403);
		expect((await PATCH(request("PATCH", { status: "invalid" }), params())).status).toBe(400);
		h.env = {} as CloudflareEnv;
		expect((await PATCH(request("PATCH", { status: "paused" }), params())).status).toBe(503);
	});

	it("requires recent exact-organization authentication to expand retention", async () => {
		h.recent.mockResolvedValue(null);
		expect((await PATCH(request("PATCH", { retainOriginal: true }), params())).status).toBe(403);
		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_other" });
		expect((await PATCH(request("PATCH", { retainOriginal: true }), params())).status).toBe(403);
		h.recent.mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
		expect((await PATCH(request("PATCH", { retainOriginal: true }), params())).status).toBe(200);
	});

	it("maps update ownership and state conflicts", async () => {
		h.update.mockResolvedValue({ status: "not-found" });
		expect((await PATCH(request("PATCH", { status: "paused" }), params())).status).toBe(404);
		h.update.mockResolvedValue({ status: "conflict" });
		expect((await PATCH(request("PATCH", { status: "paused" }), params())).status).toBe(409);
		h.user = { id: "usr_1", organizationId: null };
		expect((await PATCH(request("PATCH", { status: "paused" }), params())).status).toBe(403);
	});

	it("disconnects only with recent same-origin authentication", async () => {
		expect((await DELETE(request("DELETE"), params())).status).toBe(200);
		h.disconnect.mockResolvedValue({ status: "not-found" });
		expect((await DELETE(request("DELETE"), params())).status).toBe(404);
		h.disconnect.mockResolvedValue({ status: "conflict" });
		expect((await DELETE(request("DELETE"), params())).status).toBe(409);
		h.recent.mockResolvedValue(null);
		expect((await DELETE(request("DELETE"), params())).status).toBe(403);
		expect((await DELETE(request("DELETE", undefined, "https://evil.example"), params())).status).toBe(403);
		h.env = {} as CloudflareEnv;
		expect((await DELETE(request("DELETE"), params())).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		h.user = { id: "usr_1", organizationId: null };
		expect((await DELETE(request("DELETE"), params())).status).toBe(403);
	});
});
