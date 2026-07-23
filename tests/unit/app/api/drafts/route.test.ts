import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, guardUser: vi.fn(), getMailboxAccess: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/auth/mailbox-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth/mailbox-access")>()),
	getMailboxAccess: m.getMailboxAccess,
}));
vi.mock("@/lib/ids", () => ({ newId: (p?: string) => (p === "msg" ? "msg_1" : "body_1") }));
vi.mock("@/lib/email/parse", () => ({ buildSnippet: () => "snippet" }));

import { GET, POST } from "@/app/api/drafts/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.getMailboxAccess.mockReset();
});

function post(body: unknown) {
	return new Request("https://x.test/api/drafts", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

describe("GET /api/drafts", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await GET(new Request("https://x.test/api/drafts"));
		expect(res.status).toBe(401);
	});

	it("lists drafts without a mailbox filter", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "msg_1" }]);
		const res = await GET(new Request("https://x.test/api/drafts"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ drafts: [{ id: "msg_1" }] });
	});

	it("lists drafts with a mailbox filter", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		mock.queueSelect([{ id: "msg_1", mailboxId: "mb_1" }]);
		const res = await GET(new Request("https://x.test/api/drafts?mailboxId=mb_1"));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ drafts: [{ id: "msg_1", mailboxId: "mb_1" }] });
	});
});

describe("POST /api/drafts", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(post({}));
		expect(res.status).toBe(401);
	});

	it("creates a draft with provided fields", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.getMailboxAccess.mockResolvedValue({ role: "responder" });
		const res = await POST(
			post({
				mailboxId: "mb_1",
				from: "me@x.test",
				to: "you@x.test",
				subject: "Hi",
				text: "body",
				html: "<p>body</p>",
			}),
		);
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ draft: { id: "msg_1" } });
			expect(mock.inserts[0].values).toMatchObject({
			id: "msg_1",
			userId: "u1",
			organizationId: "o1",
			mailboxId: "mb_1",
			direction: "outbound",
			fromAddr: "me@x.test",
			toAddr: "you@x.test",
			subject: "Hi",
			status: "draft",
			read: true,
		});
		expect(mock.inserts[1].values).toMatchObject({
			id: "body_1",
			messageId: "msg_1",
			textBody: "body",
			htmlBody: "<p>body</p>",
		});
	});

	it("hides a mailbox draft target from a viewer", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		m.getMailboxAccess.mockResolvedValue({ role: "viewer" });
		const res = await POST(post({ mailboxId: "mb_1" }));
		expect(res.status).toBe(404);
		expect(mock.inserts).toHaveLength(0);
	});

	it("hides a mailbox draft target when the user has no organization", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: null } });
		const res = await POST(post({ mailboxId: "mb_1" }));
		expect(res.status).toBe(404);
		expect(m.getMailboxAccess).not.toHaveBeenCalled();
	});

	it("defaults all optional fields when omitted", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "o1" } });
		const res = await POST(post({}));
		expect(res.status).toBe(200);
		expect(mock.inserts[0].values).toMatchObject({
			mailboxId: null,
			fromAddr: "",
			toAddr: "",
			subject: null,
		});
		expect(mock.inserts[1].values).toMatchObject({
			textBody: null,
			htmlBody: null,
		});
	});
});
