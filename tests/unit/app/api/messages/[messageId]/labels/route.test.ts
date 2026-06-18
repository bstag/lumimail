import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));

import { GET, POST, DELETE } from "@/app/api/messages/[messageId]/labels/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
});

const auth = () => m.guardUser.mockResolvedValue({ user: { id: "u1" }, errorResponse: null });

function makeReq(method: string, body?: unknown, raw?: string) {
	return new Request("https://x.test/api/messages/m1/labels", {
		method,
		body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
	});
}
const params = (messageId = "m1") => ({ params: Promise.resolve({ messageId }) });

describe("GET /api/messages/[messageId]/labels", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ user: null, errorResponse: unauth });
		const res = await GET(makeReq("GET"), params());
		expect(res.status).toBe(401);
	});

	it("returns the labels for a message", async () => {
		auth();
		mock.queueSelect([{ id: "m1" }]); // message .get() (non-empty => truthy)
		mock.queueSelect([{ label: { id: "lbl1", name: "Work" } }]); // joined rows
		const res = await GET(makeReq("GET"), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: [{ id: "lbl1", name: "Work" }],
		});
	});

	it("returns 404 when the message is not found", async () => {
		auth();
		mock.queueSelect([]); // message .get() -> undefined => !msg
		const res = await GET(makeReq("GET"), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Message not found" },
		});
	});
});

describe("POST /api/messages/[messageId]/labels", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ user: null, errorResponse: unauth });
		const res = await POST(makeReq("POST", { labelId: "lbl1" }), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 for invalid JSON", async () => {
		auth();
		const res = await POST(makeReq("POST", undefined, "not-json{"), params());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Invalid JSON" } });
	});

	it("returns 400 when labelId is missing/invalid", async () => {
		auth();
		const res = await POST(makeReq("POST", { labelId: "" }), params());
		expect(res.status).toBe(400);
	});

	it("attaches the label and returns 201", async () => {
		auth();
		mock.queueSelect([{ id: "m1" }]); // message .get()
		mock.queueSelect([{ id: "lbl1", userId: "u1" }]); // label .get()
		const res = await POST(makeReq("POST", { labelId: "lbl1" }), params());
		expect(res.status).toBe(201);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { messageId: "m1", labelId: "lbl1" },
		});
		expect(mock.inserts[0].values).toEqual({ messageId: "m1", labelId: "lbl1" });
	});

	it("returns 404 when the message is not found", async () => {
		auth();
		mock.queueSelect([]); // message .get() -> undefined => !msg
		const res = await POST(makeReq("POST", { labelId: "lbl1" }), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Message not found" },
		});
	});

	it("returns 404 when the label is not found", async () => {
		auth();
		mock.queueSelect([{ id: "m1" }]); // message .get() -> truthy
		mock.queueSelect([]); // label .get() -> undefined => !label
		const res = await POST(makeReq("POST", { labelId: "lbl1" }), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Label not found" },
		});
		expect(mock.inserts).toHaveLength(0);
	});
});

describe("DELETE /api/messages/[messageId]/labels", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ user: null, errorResponse: unauth });
		const res = await DELETE(makeReq("DELETE", { labelId: "lbl1" }), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 for invalid JSON", async () => {
		auth();
		const res = await DELETE(makeReq("DELETE", undefined, "{bad"), params());
		expect(res.status).toBe(400);
	});

	it("returns 400 when labelId is invalid", async () => {
		auth();
		const res = await DELETE(makeReq("DELETE", {}), params());
		expect(res.status).toBe(400);
	});

	it("detaches the label", async () => {
		auth();
		mock.queueSelect([{ id: "m1" }]); // message .get()
		const res = await DELETE(makeReq("DELETE", { labelId: "lbl1" }), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { messageId: "m1", labelId: "lbl1" },
		});
		expect(mock.deletes).toHaveLength(1);
	});

	it("returns 404 when the message is not found", async () => {
		auth();
		mock.queueSelect([]); // message .get() -> undefined => !msg
		const res = await DELETE(makeReq("DELETE", { labelId: "lbl1" }), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Message not found" },
		});
		expect(mock.deletes).toHaveLength(0);
	});
});
