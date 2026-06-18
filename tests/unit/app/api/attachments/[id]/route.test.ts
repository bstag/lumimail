import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	env: { BUCKET: { get: vi.fn() } } as { BUCKET: { get: ReturnType<typeof vi.fn> } },
	guardUser: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => m.env }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));

import { GET } from "@/app/api/attachments/[id]/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const params = (id = "att1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.env.BUCKET.get = vi.fn();
	m.guardUser.mockReset();
});

const req = (qs = "") => new Request(`https://x.test/api/attachments/att1${qs}`);

const row = {
	id: "att1",
	filename: "my file.pdf",
	contentType: "application/pdf",
	size: 1234,
	r2Key: "attachments/u1/m1/att1/my file.pdf",
	messageUserId: "u1",
};

describe("GET /api/attachments/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 404 when the attachment is not found / not owned", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]);
		const res = await GET(req(), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Attachment not found" } });
	});

	it("returns 404 when the R2 object is missing", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([row]);
		m.env.BUCKET.get.mockResolvedValue(null);
		const res = await GET(req(), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "File not found" } });
	});

	it("streams the file as an attachment by default", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([row]);
		m.env.BUCKET.get.mockResolvedValue({ body: "stream-body" });
		const res = await GET(req(), params());
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("application/pdf");
		expect(res.headers.get("Content-Length")).toBe("1234");
		expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
		const cd = res.headers.get("Content-Disposition");
		expect(cd).toContain("attachment;");
		expect(cd).toContain(encodeURIComponent("my file.pdf"));
	});

	it("uses inline disposition when requested", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([row]);
		m.env.BUCKET.get.mockResolvedValue({ body: "stream-body" });
		const res = await GET(req("?disposition=inline"), params());
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Disposition")).toContain("inline;");
	});
});
