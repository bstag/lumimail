import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	getCurrentUser: vi.fn(),
	getMailboxAccess: vi.fn(),
	listAccessibleMailboxIds: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/ids", () => ({ newId: (p: string) => `${p}_1` }));
vi.mock("@/lib/auth/mailbox-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth/mailbox-access")>()),
	getMailboxAccess: m.getMailboxAccess,
	listAccessibleMailboxIds: m.listAccessibleMailboxIds,
}));

import { GET, PUT } from "@/app/api/vacation/route";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const authed = { id: "u1", organizationId: "org_1" };

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
	m.getMailboxAccess.mockReset();
	m.listAccessibleMailboxIds.mockReset();
	m.listAccessibleMailboxIds.mockResolvedValue(["mb_1"]);
	m.getMailboxAccess.mockResolvedValue({ mailboxId: "mb_1", organizationId: "org_1", role: "manager" });
});

function putReq(body?: unknown) {
	return new Request("https://x.test/api/vacation", {
		method: "PUT",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const validPut = { mailboxId: "mb_1", enabled: true };

describe("GET /api/vacation", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await GET(new Request("https://x.test/api/vacation"));
		expect(res.status).toBe(401);
	});

	it("returns one responder per manageable mailbox", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([{ id: "vac1", mailboxId: "mb_1", enabled: true }]);

		const res = await GET(new Request("https://x.test/api/vacation"));

		expect(res.status).toBe(200);
		expect((await res.json()) as unknown).toEqual({
			success: true,
			data: { responders: [{ id: "vac1", mailboxId: "mb_1", enabled: true }] },
		});
		// Only mailboxes the caller may manage are consulted.
		expect(m.listAccessibleMailboxIds).toHaveBeenCalledWith(
			expect.anything(), "u1", "org_1", "manage",
		);
	});

	it("returns an empty list when the caller manages no mailbox", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		m.listAccessibleMailboxIds.mockResolvedValue([]);

		const res = await GET(new Request("https://x.test/api/vacation"));

		expect((await res.json()) as unknown).toEqual({ success: true, data: { responders: [] } });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("returns an empty list for a user with no organization", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null });

		const res = await GET(new Request("https://x.test/api/vacation"));

		expect((await res.json()) as unknown).toEqual({ success: true, data: { responders: [] } });
		expect(m.listAccessibleMailboxIds).not.toHaveBeenCalled();
	});
});

describe("PUT /api/vacation", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		expect((await PUT(putReq(validPut))).status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		expect((await PUT(putReq({ mailboxId: "mb_1", enabled: "yes" }))).status).toBe(400);
	});

	it("requires a mailbox to act on", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		const res = await PUT(putReq({ enabled: true }));
		expect(res.status).toBe(400);
	});

	it("refuses a mailbox the caller cannot manage", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		m.getMailboxAccess.mockResolvedValue(null);

		const res = await PUT(putReq(validPut));

		// 404 rather than 403 so the response cannot confirm the mailbox exists.
		expect(res.status).toBe(404);
		expect(mock.updates).toHaveLength(0);
		expect(mock.inserts).toHaveLength(0);
	});

	it("refuses a member who can send but not manage", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		m.getMailboxAccess.mockResolvedValue({ mailboxId: "mb_1", organizationId: "org_1", role: "responder" });

		const res = await PUT(putReq(validPut));

		// A responder changes how the mailbox answers everyone, so send is not enough.
		expect(res.status).toBe(404);
		expect(mock.inserts).toHaveLength(0);
	});

	it("refuses a user with no organization", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null });

		expect((await PUT(putReq(validPut))).status).toBe(404);
		expect(m.getMailboxAccess).not.toHaveBeenCalled();
	});

	it("updates the responder belonging to that mailbox", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([{ id: "vac1" }]);

		const res = await PUT(putReq({
			mailboxId: "mb_1",
			enabled: true,
			subject: "Away",
			body: "Back soon",
			startDate: "2026-01-01T00:00:00.000Z",
			endDate: "2026-01-10T00:00:00.000Z",
			replyToContacts: true,
		}));

		expect(res.status).toBe(200);
		expect(mock.updates[0].set).toMatchObject({
			enabled: true,
			subject: "Away",
			body: "Back soon",
			replyToContacts: true,
			replyToOrganization: false,
		});
		expect(mock.inserts).toHaveLength(0);
	});

	it("inserts a responder for a mailbox that has none", async () => {
		m.getCurrentUser.mockResolvedValue(authed);
		mock.queueSelect([]);

		await PUT(putReq({ mailboxId: "mb_1", enabled: false }));

		expect(mock.inserts[0].values).toMatchObject({
			id: "vac_1",
			mailboxId: "mb_1",
			userId: "u1",
			enabled: false,
			subject: "Out of office",
			startDate: null,
			endDate: null,
			replyToContacts: false,
			replyToOrganization: false,
		});
	});
});
