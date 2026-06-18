import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/ids", () => ({ newId: (p?: string) => (p === "whsec" ? "whsec_1" : "wh_1") }));

import { GET, POST } from "@/app/api/webhooks/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

function post(body: unknown) {
	return new Request("https://x.test/api/webhooks", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

describe("GET /api/webhooks", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(new Request("https://x.test/api/webhooks"));
		expect(res.status).toBe(401);
	});

	it("lists the user's webhooks with projected fields only", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([
			{ id: "wh_1", url: "https://h.test", events: "[]", enabled: true, secret: "leak", userId: "u1" },
		]);
		const res = await GET(new Request("https://x.test/api/webhooks"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			webhooks: [{ id: "wh_1", url: "https://h.test", events: "[]", enabled: true }],
		});
	});
});

describe("POST /api/webhooks", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(post({ url: "https://h.test", events: ["delivered"] }));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(post({ url: "not-a-url", events: [] }));
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).error).toBeDefined();
	});

	it("creates a webhook and returns the secret once", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(post({ url: "https://h.test", events: ["delivered"] }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			id: "wh_1",
			url: "https://h.test",
			secret: "whsec_1",
			events: ["delivered"],
		});
		expect(mock.inserts[0].values).toMatchObject({
			id: "wh_1",
			userId: "u1",
			url: "https://h.test",
			secret: "whsec_1",
			events: JSON.stringify(["delivered"]),
			enabled: true,
		});
	});
});
