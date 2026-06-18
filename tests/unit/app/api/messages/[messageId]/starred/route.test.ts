import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));

import { PATCH } from "@/app/api/messages/[messageId]/starred/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

function patch(body: unknown, messageId = "m1") {
	return PATCH(
		new Request("https://x.test/api/messages/m1/starred", {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
		{ params: Promise.resolve({ messageId }) },
	);
}

describe("PATCH /api/messages/[messageId]/starred", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ user: null, errorResponse: unauth });
		const res = await patch({ starred: true });
		expect(res.status).toBe(401);
	});

	it("stars a message and returns the updated value (200)", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" }, errorResponse: null });
		mock.queueSelect([{ starred: true }]); // update().returning() -> [updated]
		const res = await patch({ starred: true });
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ starred: true });
		expect(mock.updates[0].set).toEqual({ starred: true });
	});

	it("unstars a message and returns the updated value (200)", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" }, errorResponse: null });
		mock.queueSelect([{ starred: false }]); // update().returning() -> [updated]
		const res = await patch({ starred: false });
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ starred: false });
		expect(mock.updates[0].set).toEqual({ starred: false });
	});

	it("returns 404 when no message matches (empty returning())", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" }, errorResponse: null });
		mock.queueSelect([]); // update().returning() -> [] => updated undefined
		const res = await patch({ starred: true });
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({ error: "Not found" });
	});
});
