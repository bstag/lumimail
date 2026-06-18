import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { GET } from "@/app/api/messages/thread/[threadId]/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
});

function get(threadId = "t1") {
	return GET(new Request("https://x.test/api/messages/thread/t1"), {
		params: Promise.resolve({ threadId }),
	});
}

describe("GET /api/messages/thread/[threadId]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(401);
	});

	it("returns the thread messages ordered by creation (scoped to user)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([
			{ id: "m1", threadId: "t1", textBody: "hi", htmlBody: null },
			{ id: "m2", threadId: "t1", textBody: null, htmlBody: "<p>x</p>" },
		]);
		const res = await get();
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].id).toBe("m1");
	});

	it("returns an empty list when the thread has no messages", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([]);
		const res = await get("t-empty");
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ messages: [] });
	});
});
