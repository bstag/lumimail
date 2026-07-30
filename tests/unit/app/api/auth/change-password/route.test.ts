import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	getCurrentUser: vi.fn(),
	verifyPassword: vi.fn(),
	hashPassword: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/auth/password", () => ({
	verifyPassword: m.verifyPassword,
	hashPassword: m.hashPassword,
}));

import { POST } from "@/app/api/auth/change-password/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset().mockResolvedValue({ id: "u1" });
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
	it("returns 401 in the envelope when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await POST(req({ currentPassword: "x", newPassword: "longenough" }));
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Unauthorized" },
		});
	});

	it("returns 400 for an invalid body", async () => {
		const res = await POST(req({ currentPassword: "", newPassword: "short" }));
		expect(res.status).toBe(400);
	});

	it("returns 401 when the user row is missing", async () => {
		mock.queueSelect([]);
		const res = await POST(req({ currentPassword: "old", newPassword: "newpassword" }));
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({ error: "Current password is incorrect" });
	});

	it("returns 401 when the current password is incorrect", async () => {
		mock.queueSelect([{ id: "u1", passwordHash: "h" }]);
		m.verifyPassword.mockReturnValue(false);
		const res = await POST(req({ currentPassword: "wrong", newPassword: "newpassword" }));
		expect(res.status).toBe(401);
	});

	it("updates the password on success", async () => {
		mock.queueSelect([{ id: "u1", passwordHash: "h" }]);
		m.verifyPassword.mockReturnValue(true);
		m.hashPassword.mockReturnValue("new-hash");
		const res = await POST(req({ currentPassword: "old", newPassword: "newpassword" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ ok: true });
		expect(mock.updates[0].set).toMatchObject({ passwordHash: "new-hash" });
	});
});
