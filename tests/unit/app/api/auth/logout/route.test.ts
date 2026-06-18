import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	deleteSession: vi.fn(),
	cookieGet: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("next/headers", () => ({
	cookies: async () => ({ get: m.cookieGet }),
}));
vi.mock("@/lib/auth/session", () => ({
	deleteSession: m.deleteSession,
	SESSION_COOKIE: "ep_session",
}));

import { POST } from "@/app/api/auth/logout/route";

beforeEach(() => {
	m.deleteSession.mockReset().mockResolvedValue(undefined);
	m.cookieGet.mockReset().mockReturnValue(undefined);
});

function req(headers?: Record<string, string>) {
	return new Request("https://x.test/api/auth/logout", { method: "POST", headers });
}

describe("POST /api/auth/logout", () => {
	it("deletes the session from the Bearer token", async () => {
		const res = await POST(req({ Authorization: "Bearer bear-token" }));
		expect(res.status).toBe(200);
		expect(m.deleteSession).toHaveBeenCalledWith({}, "bear-token");
		expect(res.cookies.get("ep_session")?.value).toBe("");
		expect((await res.json()) as any).toEqual({ ok: true });
	});

	it("falls back to the session cookie when no Bearer token", async () => {
		m.cookieGet.mockReturnValue({ value: "cookie-token" });
		const res = await POST(req());
		expect(res.status).toBe(200);
		expect(m.deleteSession).toHaveBeenCalledWith({}, "cookie-token");
	});

	it("ignores a malformed Authorization header and finds no token", async () => {
		const res = await POST(req({ Authorization: "Basic abc" }));
		expect(res.status).toBe(200);
		expect(m.deleteSession).not.toHaveBeenCalled();
	});

	it("does not call deleteSession when there is no token", async () => {
		const res = await POST(req());
		expect(res.status).toBe(200);
		expect(m.deleteSession).not.toHaveBeenCalled();
	});
});
