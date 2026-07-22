import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	hashPassword: vi.fn(),
	hashToken: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: m.hashPassword }));
vi.mock("@/lib/auth/password-reset", () => ({ hashPasswordResetToken: m.hashToken }));

import { POST } from "@/app/api/auth/reset-password/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.hashPassword.mockReset().mockReturnValue("new-hash");
	m.hashToken.mockReset().mockResolvedValue("token-hash");
});

function req(body?: unknown) {
	return new Request("https://x.test/api/auth/reset-password", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const validBody = { token: "tok", email: "A@x.test", newPassword: "longenough" };

describe("POST /api/auth/reset-password", () => {
	it.each([
		{ email: "a@x.test", newPassword: "longenough" },
		{ token: "tok", newPassword: "longenough" },
		{ token: "tok", email: "a@x.test", newPassword: "short" },
		{ token: "tok", email: "not-an-email", newPassword: "longenough" },
	])("returns 400 for invalid input %#", async (body) => {
		const res = await POST(req(body));
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { message: "Invalid request" } });
	});

	it("returns 400 for malformed JSON", async () => {
		const res = await POST(
			new Request("https://x.test/api/auth/reset-password", { method: "POST", body: "{" }),
		);
		expect(res.status).toBe(400);
	});

	it("returns the same safe error when the user does not exist", async () => {
		mock.queueSelect([]);
		const res = await POST(req(validBody));
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { message: "Invalid or expired token" } });
	});

	it("looks up the token by digest and rejects an unknown or used token", async () => {
		mock.queueSelect([{ id: "u1" }]).queueSelect([]);
		const res = await POST(req(validBody));
		expect(res.status).toBe(400);
		expect(m.hashToken).toHaveBeenCalledWith("tok");
		expect(mock.updates).toHaveLength(0);
	});

	it("rejects an expired token without claiming it", async () => {
		mock.queueSelect([{ id: "u1" }]).queueSelect([
			{ id: "t1", tokenHash: "token-hash", expiresAt: new Date(Date.now() - 1000), used: false },
		]);
		const res = await POST(req(validBody));
		expect(res.status).toBe(400);
		expect(mock.updates).toHaveLength(0);
	});

	it("rejects a token another request claimed concurrently", async () => {
		mock
			.queueSelect([{ id: "u1" }])
			.queueSelect([{ id: "t1", expiresAt: new Date(Date.now() + 60_000), used: false }])
			.queueSelect([]);
		const res = await POST(req(validBody));
		expect(res.status).toBe(400);
		expect(m.hashPassword).not.toHaveBeenCalled();
	});

	it("claims once, changes the password, invalidates all tokens, and revokes sessions", async () => {
		mock
			.queueSelect([{ id: "u1" }])
			.queueSelect([{ id: "t-good", expiresAt: new Date(Date.now() + 60_000), used: false }])
			.queueSelect([{ id: "t-good" }]);

		const res = await POST(req(validBody));

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ success: true, data: { ok: true } });
		expect(mock.updates).toHaveLength(3);
		expect(mock.updates[0].set).toEqual({ used: true });
		expect(mock.updates[1].set).toEqual({ passwordHash: "new-hash" });
		expect(mock.updates[2].set).toEqual({ used: true });
		expect(mock.deletes).toHaveLength(1);
	});
});
