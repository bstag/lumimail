import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	verifyPassword: vi.fn(),
	hashPassword: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/auth/password", () => ({
	verifyPassword: m.verifyPassword,
	hashPassword: m.hashPassword,
}));

import { POST } from "@/app/api/auth/change-password/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.verifyPassword.mockReset();
	m.hashPassword.mockReset();
});

function req(body?: unknown) {
	return new Request("https://x.test/api/auth/change-password", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("POST /api/auth/change-password", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(req({ currentPassword: "x", newPassword: "longenough" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(req({ currentPassword: "", newPassword: "short" }));
		expect(res.status).toBe(400);
	});

	it("returns 401 when the user row is missing", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]);
		const res = await POST(req({ currentPassword: "old", newPassword: "newpassword" }));
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({ error: "Current password is incorrect" });
	});

	it("returns 401 when the current password is incorrect", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "u1", passwordHash: "h" }]);
		m.verifyPassword.mockReturnValue(false);
		const res = await POST(req({ currentPassword: "wrong", newPassword: "newpassword" }));
		expect(res.status).toBe(401);
	});

	it("updates the password on success", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "u1", passwordHash: "h" }]);
		m.verifyPassword.mockReturnValue(true);
		m.hashPassword.mockReturnValue("new-hash");
		const res = await POST(req({ currentPassword: "old", newPassword: "newpassword" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ ok: true });
		expect(mock.updates[0].set).toMatchObject({ passwordHash: "new-hash" });
	});
});
