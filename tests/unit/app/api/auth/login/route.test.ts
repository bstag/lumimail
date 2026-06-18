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
vi.mock("@/lib/auth/session", () => ({
	createSession: m.createSession,
	SESSION_COOKIE: "ep_session",
}));
vi.mock("@/lib/user", () => ({ userHasMailboxes: m.userHasMailboxes }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitIp: m.rateLimitIp }));

import { POST } from "@/app/api/auth/login/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.verifyPassword.mockReset();
	m.createSession.mockReset().mockResolvedValue("sess-token");
	m.userHasMailboxes.mockReset();
	m.rateLimitIp.mockReset().mockReturnValue({ allowed: true });
});

function req(body?: unknown) {
	return new Request("https://x.test/api/auth/login", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("POST /api/auth/login", () => {
	it("returns 429 when rate limited", async () => {
		m.rateLimitIp.mockReturnValue({ allowed: false });
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
		expect((await res.json()) as any).toEqual({ ok: true, token: "sess-token", redirect: "/inbox" });
		expect(res.cookies.get("ep_session")?.value).toBe("sess-token");
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
