import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	verifyPassword: vi.fn(),
	createSession: vi.fn(),
	userHasMailboxes: vi.fn(),
	rateLimitIp: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/password", () => ({ verifyPassword: m.verifyPassword }));
// Partial mock: the route also uses the real setSessionCookie helper.
vi.mock("@/lib/auth/session", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth/session")>()),
	createSession: m.createSession,
}));
vi.mock("@/lib/user", () => ({ userHasMailboxes: m.userHasMailboxes }));
// Partial mock: enforceRateLimit stays real so the route's 429/503 handling
// (and the RateLimitUnavailableError instanceof check) run genuine code.
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/rate-limit")>()),
	rateLimitIp: m.rateLimitIp,
}));

import { POST } from "@/app/api/auth/login/route";
import { RateLimitUnavailableError } from "@/lib/rate-limit";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.verifyPassword.mockReset();
	m.createSession.mockReset().mockResolvedValue("sess-token");
	m.userHasMailboxes.mockReset();
	m.rateLimitIp.mockReset().mockResolvedValue({ allowed: true });
});

function req(body?: unknown) {
	return new Request("https://x.test/api/auth/login", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("POST /api/auth/login", () => {
	it("returns 429 when rate limited", async () => {
		m.rateLimitIp.mockResolvedValue({ allowed: false });
		const res = await POST(req({ email: "a@x.test", password: "pw" }));
		expect(res.status).toBe(429);
		expect((await res.json()) as any).toEqual({ error: "Too many attempts" });
	});

	it("returns 400 for an invalid body", async () => {
		const res = await POST(req({ email: "not-an-email", password: "" }));
		expect(res.status).toBe(400);
	});

	it("returns 401 when the user is not found", async () => {
		mock.queueSelect([]);
		const res = await POST(req({ email: "a@x.test", password: "pw" }));
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({ error: "Invalid credentials" });
	});

	it("returns 401 when the password is wrong", async () => {
		mock.queueSelect([{ id: "u1", passwordHash: "h" }]);
		m.verifyPassword.mockReturnValue(false);
		const res = await POST(req({ email: "a@x.test", password: "pw" }));
		expect(res.status).toBe(401);
	});

	it("logs in and redirects to /inbox when the user has mailboxes", async () => {
		mock.queueSelect([{ id: "u1", passwordHash: "h" }]);
		m.verifyPassword.mockReturnValue(true);
		m.userHasMailboxes.mockResolvedValue(true);
		const res = await POST(req({ email: "a@x.test", password: "pw" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ ok: true, redirect: "/inbox" });
		expect(res.cookies.get("ep_session")?.value).toBe("sess-token");
	});

	it("fails closed when shared rate-limit storage is unavailable", async () => {
		m.rateLimitIp.mockRejectedValue(new RateLimitUnavailableError());
		const res = await POST(req({ email: "a@x.test", password: "pw" }));
		expect(res.status).toBe(503);
		expect((await res.json()) as any).toEqual({ error: "Service temporarily unavailable" });
		expect(m.createSession).not.toHaveBeenCalled();
	});

	it("rethrows unexpected limiter errors", async () => {
		m.rateLimitIp.mockRejectedValue(new Error("unexpected"));
		await expect(POST(req({ email: "a@x.test", password: "pw" }))).rejects.toThrow("unexpected");
	});

	it("redirects to /onboarding when the user has no mailboxes", async () => {
		mock.queueSelect([{ id: "u1", passwordHash: "h" }]);
		m.verifyPassword.mockReturnValue(true);
		m.userHasMailboxes.mockResolvedValue(false);
		const res = await POST(req({ email: "a@x.test", password: "pw" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toMatchObject({ redirect: "/onboarding" });
	});
});
