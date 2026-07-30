import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { PATCH } from "@/app/api/messages/[messageId]/starred/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset().mockResolvedValue({ id: "u1" });
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
	it("returns 401 in the envelope when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await patch({ starred: true });
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Unauthorized" },
		});
	});

	it("returns an enveloped 400 for malformed JSON", async () => {
		const res = await PATCH(
			new Request("https://x.test/api/messages/m1/starred", { method: "PATCH", body: "{" }),
			{ params: Promise.resolve({ messageId: "m1" }) },
		);
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Invalid JSON" },
		});
		expect(mock.updates).toHaveLength(0);
	});

	it("returns an enveloped 400 when starred is not a boolean", async () => {
		const res = await patch({ starred: "yes" });
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).error.message).toContain("starred");
		expect(mock.updates).toHaveLength(0);
	});

	it("stars a message and returns the updated value (200)", async () => {
		mock.queueSelect([{ starred: true }]); // update().returning() -> [updated]
		const res = await patch({ starred: true });
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ starred: true });
		expect(mock.updates[0].set).toEqual({ starred: true });
	});

	it("unstars a message and returns the updated value (200)", async () => {
		mock.queueSelect([{ starred: false }]); // update().returning() -> [updated]
		const res = await patch({ starred: false });
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ starred: false });
		expect(mock.updates[0].set).toEqual({ starred: false });
	});

	it("returns 404 when no message matches (empty returning())", async () => {
		mock.queueSelect([]); // update().returning() -> [] => updated undefined
		const res = await patch({ starred: true });
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({ error: "Not found" });
	});
});
