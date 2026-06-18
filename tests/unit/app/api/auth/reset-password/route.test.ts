import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	hashPassword: vi.fn(),
	verifyPassword: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/password", () => ({
	hashPassword: m.hashPassword,
	verifyPassword: m.verifyPassword,
}));

import { POST } from "@/app/api/auth/reset-password/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.hashPassword.mockReset().mockReturnValue("new-hash");
	m.verifyPassword.mockReset();
});

function req(body?: unknown) {
	return new Request("https://x.test/api/auth/reset-password", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const validBody = { token: "tok", email: "A@x.test", newPassword: "longenough" };

describe("POST /api/auth/reset-password", () => {
	it("returns 400 when token is missing", async () => {
		const res = await POST(req({ email: "a@x.test", newPassword: "longenough" }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when email is missing", async () => {
		const res = await POST(req({ token: "tok", newPassword: "longenough" }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when newPassword is too short", async () => {
		const res = await POST(req({ token: "tok", email: "a@x.test", newPassword: "short" }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when newPassword is not a string", async () => {
		const res = await POST(req({ token: "tok", email: "a@x.test", newPassword: 12345678 }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when the user does not exist", async () => {
		mock.queueSelect([]);
		const res = await POST(req(validBody));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Invalid or expired token" } });
	});

	it("returns 400 when no token matches", async () => {
		mock.queueSelect([{ id: "u1" }]); // user lookup
		mock.queueSelect([
			{ id: "t1", tokenHash: "h1", expiresAt: new Date(Date.now() + 1000) },
		]); // tokens
		m.verifyPassword.mockReturnValue(false);
		const res = await POST(req(validBody));
		expect(res.status).toBe(400);
	});

	it("returns 400 when the matching token is expired", async () => {
		mock.queueSelect([{ id: "u1" }]);
		mock.queueSelect([
			{ id: "t1", tokenHash: "h1", expiresAt: new Date(Date.now() - 1000) },
		]);
		m.verifyPassword.mockReturnValue(true);
		const res = await POST(req(validBody));
		expect(res.status).toBe(400);
	});

	it("resets the password and revokes sessions on success", async () => {
		mock.queueSelect([{ id: "u1" }]);
		mock.queueSelect([
			{ id: "t-old", tokenHash: "hx", expiresAt: new Date(Date.now() - 1000) },
			{ id: "t-good", tokenHash: "hg", expiresAt: new Date(Date.now() + 60_000) },
		]);
		// first token: verify false (skip), second: verify true & not expired
		m.verifyPassword.mockReturnValueOnce(false).mockReturnValueOnce(true);
		const res = await POST(req(validBody));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toMatchObject({ success: true, data: { ok: true } });
		expect(mock.updates[0].set).toMatchObject({ passwordHash: "new-hash" });
		expect(mock.updates[1].set).toMatchObject({ used: true });
		expect(mock.deletes.length).toBe(1);
	});
});
