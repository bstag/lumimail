import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));

import { DELETE } from "@/app/api/api-keys/[id]/route";

let mock: DbMock;
const unauthenticated = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const context = (id = "key_1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

describe("DELETE /api/api-keys/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauthenticated });
		const response = await DELETE(new Request("https://x.test/api/api-keys/key_1"), context());
		expect(response.status).toBe(401);
		expect(mock.updates).toHaveLength(0);
	});

	it("returns the same 404 for an unknown, other-user, or already-revoked key", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "user_1" } });
		mock.queueSelect([]);
		const response = await DELETE(new Request("https://x.test/api/api-keys/other"), context("other"));
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "API key not found" });
		expect(mock.updates[0].set).toEqual({ revokedAt: expect.any(Date) });
	});

	it("permanently revokes an active key and returns no secret", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "user_1" } });
		mock.queueSelect([{ id: "key_1" }]);
		const response = await DELETE(new Request("https://x.test/api/api-keys/key_1"), context());
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body).toEqual({ ok: true });
		expect(JSON.stringify(body)).not.toContain("keyHash");
		expect(JSON.stringify(body)).not.toContain("fullKey");
		expect(mock.updates[0].set).toEqual({ revokedAt: expect.any(Date) });
	});
});
