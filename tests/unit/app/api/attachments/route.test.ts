import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	env: { BUCKET: { put: vi.fn() } } as { BUCKET: { put: ReturnType<typeof vi.fn> } },
	guardUser: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => m.env }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/ids", () => ({ newId: (p: string) => `${p}_1` }));

import { POST } from "@/app/api/attachments/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.env.BUCKET.put = vi.fn();
	m.guardUser.mockReset();
});

function formReq(fields: { file?: File | null; messageId?: string | null }) {
	const fd = new FormData();
	if (fields.file) fd.set("file", fields.file);
	if (fields.messageId != null) fd.set("messageId", fields.messageId);
	return new Request("https://x.test/api/attachments", { method: "POST", body: fd });
}

function makeFile(size = 10, name = "doc.pdf", type = "application/pdf") {
	return new File([new Uint8Array(size)], name, { type });
}

describe("POST /api/attachments", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(formReq({ file: makeFile(), messageId: "msg1" }));
		expect(res.status).toBe(401);
	});

	it("returns 400 when the file is missing", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(formReq({ messageId: "msg1" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "file and messageId required" } });
	});

	it("returns 400 when the messageId is missing", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(formReq({ file: makeFile() }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when the file is too large", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const big = makeFile(25 * 1024 * 1024 + 1);
		const res = await POST(formReq({ file: big, messageId: "msg1" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "File too large (max 25MB)" } });
	});

	it("returns 404 when the message is not owned by the user", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]); // no message
		const res = await POST(formReq({ file: makeFile(), messageId: "msg1" }));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Message not found" } });
	});

	it("stores the attachment and records it", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg1" }]);
		const res = await POST(formReq({ file: makeFile(10, "doc.pdf", "application/pdf"), messageId: "msg1" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { id: "att_1", filename: "doc.pdf", size: 10, contentType: "application/pdf" },
		});
		expect(m.env.BUCKET.put).toHaveBeenCalledTimes(1);
		const [key, , opts] = m.env.BUCKET.put.mock.calls[0];
		expect(key).toBe("attachments/u1/msg1/att_1/doc.pdf");
		expect(opts).toMatchObject({ httpMetadata: { contentType: "application/pdf" } });
		expect(mock.inserts[0].values).toMatchObject({
			id: "att_1",
			messageId: "msg1",
			filename: "doc.pdf",
			contentType: "application/pdf",
			size: 10,
			r2Key: "attachments/u1/msg1/att_1/doc.pdf",
		});
	});

	it("falls back to octet-stream when the parsed file has no content-type", async () => {
		// Multipart parsing defaults an empty part type to "application/octet-stream",
		// so to exercise the `file.type || ...` fallback we hand the handler a
		// request whose formData() yields a file with a genuinely empty type.
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg1" }]);
		const fakeFile = { name: "noext", size: 5, type: "", arrayBuffer: async () => new ArrayBuffer(5) };
		const fakeReq = {
			formData: async () => ({ get: (k: string) => (k === "file" ? fakeFile : "msg1") }),
		} as unknown as Request;
		const res = await POST(fakeReq);
		expect(res.status).toBe(200);
		const [, , opts] = m.env.BUCKET.put.mock.calls[0];
		expect(opts).toMatchObject({ httpMetadata: { contentType: "application/octet-stream" } });
		expect(mock.inserts[0].values).toMatchObject({ contentType: "application/octet-stream" });
	});
});
