import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { GET } from "@/app/api/messages/[messageId]/attachments/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset().mockResolvedValue({ id: "u1" });
});

function get(messageId = "m1") {
	return GET(new Request("https://x.test/api/messages/m1/attachments"), {
		params: Promise.resolve({ messageId }),
	});
}

describe("GET /api/messages/[messageId]/attachments", () => {
	it("returns 401 in the envelope when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Unauthorized" },
		});
	});

	it("returns 404 when the message is not found (cross-tenant denial)", async () => {
		mock.queueSelect([]); // [msg] => undefined => 404
		const res = await get();
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Message not found" } });
	});

	it("returns the attachments for a message", async () => {
		mock.queueSelect([{ id: "m1", attachmentStatus: "stored", attachmentError: null }]); // message exists
		mock.queueSelect([
			{ id: "a1", filename: "f.pdf", contentType: "application/pdf", size: 10 },
		]); // attachments
		const res = await get();
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: {
				attachmentStatus: "stored",
				attachmentError: null,
				attachments: [
					{ id: "a1", filename: "f.pdf", contentType: "application/pdf", size: 10 },
				],
			},
		});
	});

	it("returns an omission reason even when no attachment rows exist", async () => {
		mock.queueSelect([{
			id: "m1",
			attachmentStatus: "omitted",
			attachmentError: "Attachments were omitted.",
		}]);
		mock.queueSelect([]);
		const res = await get();
		expect((await res.json()) as any).toEqual({
			success: true,
			data: {
				attachmentStatus: "omitted",
				attachmentError: "Attachments were omitted.",
				attachments: [],
			},
		});
	});
});
