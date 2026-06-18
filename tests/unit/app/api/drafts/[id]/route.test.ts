import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	selectDraftWithBody: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/email/parse", () => ({ buildSnippet: () => "snippet" }));
vi.mock("@/app/api/drafts/[id]/utils", () => ({ selectDraftWithBody: m.selectDraftWithBody }));

import { GET, PATCH, DELETE } from "@/app/api/drafts/[id]/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const params = (id = "msg_1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.selectDraftWithBody.mockReset();
});

function req(body?: unknown) {
	return new Request("https://x.test/api/drafts/msg_1", {
		method: "PATCH",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("GET /api/drafts/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 404 when the draft is not found / cross-tenant", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.selectDraftWithBody.mockResolvedValue(null);
		const res = await GET(req(), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toEqual({ error: "Draft not found" });
	});

	it("returns the draft on success", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.selectDraftWithBody.mockResolvedValue({ id: "msg_1", status: "draft" });
		const res = await GET(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ draft: { id: "msg_1", status: "draft" } });
		expect(m.selectDraftWithBody).toHaveBeenCalledWith(mock.db, "u1", "msg_1");
	});
});

describe("PATCH /api/drafts/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await PATCH(req({}), params());
		expect(res.status).toBe(401);
	});

	it("returns 404 when the draft does not exist", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]); // no draft
		const res = await PATCH(req({}), params());
		expect(res.status).toBe(404);
	});

	it("returns 404 when the draft belongs to another user", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg_1", userId: "other", status: "draft" }]);
		const res = await PATCH(req({}), params());
		expect(res.status).toBe(404);
	});

	it("returns 404 when the message is not a draft", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg_1", userId: "u1", status: "sent" }]);
		const res = await PATCH(req({}), params());
		expect(res.status).toBe(404);
	});

	it("updates draft fields and body, defaulting omitted fields", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg_1", userId: "u1", status: "draft" }]);
		const res = await PATCH(req({}), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ draft: { id: "msg_1" } });
		expect(mock.updates[0].set).toMatchObject({
			mailboxId: null,
			fromAddr: "",
			toAddr: "",
			subject: null,
		});
		expect(mock.updates[1].set).toEqual({ textBody: null, htmlBody: null });
	});

	it("updates draft with provided field values", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg_1", userId: "u1", status: "draft" }]);
		const res = await PATCH(
			req({
				mailboxId: "mb_1",
				from: "me@x.test",
				to: "you@x.test",
				subject: "Re",
				text: "t",
				html: "<p>h</p>",
			}),
			params(),
		);
		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toMatchObject({
			mailboxId: "mb_1",
			fromAddr: "me@x.test",
			toAddr: "you@x.test",
			subject: "Re",
		});
		expect(mock.updates[1].set).toEqual({ textBody: "t", htmlBody: "<p>h</p>" });
	});
});

describe("DELETE /api/drafts/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await DELETE(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 404 when the draft does not exist", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
	});

	it("returns 404 when the draft belongs to another user", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg_1", userId: "other", status: "draft" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
	});

	it("returns 404 when the message is not a draft", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg_1", userId: "u1", status: "sent" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
	});

	it("deletes an existing draft", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		mock.queueSelect([{ id: "msg_1", userId: "u1", status: "draft" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ ok: true });
		expect(mock.deletes.length).toBe(1);
	});
});
