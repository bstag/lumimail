import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));

import { GET } from "@/app/api/messages/[messageId]/attachments/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

function get(messageId = "m1") {
	return GET(new Request("https://x.test/api/messages/m1/attachments"), {
		params: Promise.resolve({ messageId }),
	});
}

describe("GET /api/messages/[messageId]/attachments", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ user: null, errorResponse: unauth });
		const res = await get();
		expect(res.status).toBe(401);
	});

	it("returns 404 when the message is not found (cross-tenant denial)", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" }, errorResponse: null });
		mock.queueSelect([]); // [msg] => undefined => 404
		const res = await get();
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Message not found" } });
	});

	it("returns the attachments for a message", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" }, errorResponse: null });
		mock.queueSelect([{ id: "m1" }]); // message exists
		mock.queueSelect([
			{ id: "a1", filename: "f.pdf", contentType: "application/pdf", size: 10 },
		]); // attachments
		const res = await get();
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: {
				attachments: [
					{ id: "a1", filename: "f.pdf", contentType: "application/pdf", size: 10 },
				],
			},
		});
	});
});
