import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/api-keys", () => ({
	generateApiKey: () => ({ fullKey: "full-key", prefix: "pre_123", hash: "hash" }),
	scopesToJson: (s: unknown) => JSON.stringify(s),
}));
vi.mock("@/lib/ids", () => ({ newId: () => "key_1" }));

import { GET, POST } from "@/app/api/api-keys/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

function req(body?: unknown) {
	return new Request("https://x.test/api/api-keys", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/api-keys", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(new Request("https://x.test/api/api-keys"));
		expect(res.status).toBe(401);
	});

	it("lists the user's keys", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "k1", name: "CI", prefix: "pre_1" }]);
		const res = await GET(new Request("https://x.test/api/api-keys"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ apiKeys: [{ id: "k1", name: "CI", prefix: "pre_1" }] });
	});
});

describe("POST /api/api-keys", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(req({ name: "x", scopes: ["send"] }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(req({ name: "", scopes: [] }));
		expect(res.status).toBe(400);
	});

	it("creates a key and returns the secret once", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(req({ name: "CI", scopes: ["send"] }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ id: "key_1", name: "CI", prefix: "pre_123", key: "full-key" });
		expect(mock.inserts[0].values).toMatchObject({ id: "key_1", userId: "u1", name: "CI", prefix: "pre_123" });
	});
});
