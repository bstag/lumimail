import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	env: { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv,
	user: { id: "usr_1", organizationId: "org_1" } as any,
	cookie: "cookie-token" as string | undefined,
	bearer: undefined as string | undefined,
	list: vi.fn(),
	register: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({
	getCurrentUser: vi.fn(async () => h.user),
	getBearerToken: vi.fn(() => h.bearer),
}));
vi.mock("@/lib/push/devices", () => ({ listPushDevices: h.list, registerPushDevice: h.register }));
vi.mock("@/lib/ids", () => ({ newId: () => "req_fixed" }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({
	get: () => h.cookie ? { value: h.cookie } : undefined,
})) }));

import { GET, POST } from "@/app/api/push/devices/route";

const subscription = {
	endpoint: "https://fcm.googleapis.com/fcm/send/token",
	keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
};
function post(body: unknown, origin = "https://mail.example") {
	return new Request("https://mail.example/api/push/devices", {
		method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
	h.user = { id: "usr_1", organizationId: "org_1" };
	h.cookie = "cookie-token";
	h.bearer = undefined;
	h.list.mockResolvedValue({ devices: [] });
	h.register.mockResolvedValue({ status: "created", device: { id: "pud_1" } });
});

describe("/api/push/devices", () => {
	it("lists only the active user's organization and uses bearer before cookie", async () => {
		h.bearer = "bearer-token";
		const response = await GET(new Request("https://mail.example/api/push/devices"));
		expect(response.status).toBe(200);
		expect(h.list).toHaveBeenCalledWith(h.env, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "bearer-token",
		});
	});

	it("requires an active organization and configured same origin", async () => {
		h.user = { id: "usr_1", organizationId: null };
		expect((await GET(new Request("https://mail.example/api/push/devices"))).status).toBe(403);
		expect((await POST(post({ name: "Laptop", subscription }))).status).toBe(403);
		h.user = { id: "usr_1", organizationId: "org_1" };
		h.env = {} as CloudflareEnv;
		expect((await POST(post({ name: "Laptop", subscription }))).status).toBe(503);
		h.env = { PUBLIC_APP_URL: "https://mail.example" } as CloudflareEnv;
		expect((await POST(post({ name: "Laptop", subscription }, "https://evil.example"))).status).toBe(403);
	});

	it("passes an absent session token through as invalid", async () => {
		h.cookie = undefined;
		h.register.mockResolvedValue({ status: "invalid-session" });
		expect((await POST(post({ name: "Laptop", subscription }))).status).toBe(403);
		expect(h.register.mock.calls[0][1].sessionToken).toBeUndefined();
	});

	it("strictly validates and registers a zero-preference exact-session device", async () => {
		const response = await POST(post({ name: " Laptop ", subscription }));
		expect(response.status).toBe(201);
		expect(h.register).toHaveBeenCalledWith(h.env, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "cookie-token",
			name: "Laptop", subscription, requestId: "req_fixed",
		});
		expect(await response.json()).toEqual({ success: true, data: { device: { id: "pud_1" } } });
		expect((await POST(post({ name: "Laptop", subscription, mailboxIds: ["mbx_1"] }))).status).toBe(400);
	});

	it.each([
		["updated", 200],
		["invalid-session", 403],
		["conflict", 409],
		["limit", 429],
	] as const)("maps %s registration outcomes", async (status, expected) => {
		h.register.mockResolvedValue(status === "updated" ? { status, device: { id: "pud_1" } } : { status });
		expect((await POST(post({ name: "Laptop", subscription }))).status).toBe(expected);
	});
});
