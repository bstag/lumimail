import { beforeEach, describe, expect, it, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	getCurrentUser: vi.fn(),
	getContactDisplayNameMap: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/contacts/service", () => ({
	getContactDisplayNameMap: m.getContactDisplayNameMap,
}));
vi.mock("@/lib/email/address", () => ({
	normalizeEmailAddress: (addr: string) => (addr ?? "").toLowerCase(),
}));
vi.mock("@/lib/email/reply-content-utils", () => ({
	getLatestEmailContent: (s: string) => `latest:${s}`,
}));

import { GET } from "@/app/api/messages/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
	m.getContactDisplayNameMap.mockReset();
	m.getContactDisplayNameMap.mockResolvedValue(new Map());
});

function get(qs = "") {
	return GET(new Request(`https://x.test/api/messages${qs}`));
}

describe("GET /api/messages", () => {
	it("returns 401 in the envelope when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await get();
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({
			success: false,
			error: { message: "Unauthorized" },
		});
	});

	it("lists messages with no filters and enriches rows", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.getContactDisplayNameMap.mockResolvedValue(
			new Map([
				["from@x.test", "From Name"],
				["to@x.test", "To Name"],
			]),
		);
		mock.queueSelect([{ total: 1 }]); // count
		mock.queueSelect([
			{
				id: "m1",
				snippet: "body",
				fromAddr: "From@x.test",
				toAddr: "To@x.test",
			},
		]); // rows
		const res = await get();
		expect(res.status).toBe(200);
		const body = ((await res.json()) as any).data;
		expect(body.total).toBe(1);
		expect(body.limit).toBe(50);
		expect(body.offset).toBe(0);
		expect(body.messages[0]).toMatchObject({
			id: "m1",
			snippet: "latest:body",
			fromContactName: "From Name",
			toContactName: "To Name",
		});
	});

	it("falls back to null contact names and total 0 when count row missing", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([]); // count -> undefined totalRow
		mock.queueSelect([{ id: "m1", snippet: "s", fromAddr: "a@x", toAddr: "b@x" }]);
		const res = await get();
		const body = ((await res.json()) as any).data;
		expect(body.total).toBe(0);
		expect(body.messages[0].fromContactName).toBeNull();
		expect(body.messages[0].toContactName).toBeNull();
	});

	/**
	 * F76 all-mailboxes scope. The client drops `mailboxId` to list across every
	 * accessible mailbox. That must remove only the *narrowing* mailbox filter —
	 * the membership-backed access predicate has to stay, or the unscoped list
	 * would return other tenants' mail.
	 *
	 * The db mock ignores SQL semantics, so this compiles the recorded WHERE and
	 * asserts on its shape rather than on returned rows. Row-level proof lives in
	 * the local suite (tests/e2e-local), which runs against a real database.
	 */
	it("keeps the membership access predicate when no mailbox is scoped", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		await get();

		// The last recorded WHERE is the outer one: `messageAccessCondition`
		// records its own subquery WHEREs first, while it is being built.
		const query = new SQLiteSyncDialect().sqlToQuery(mock.wheres.at(-1) as SQL);
		// The predicate's shape: own private mail, OR organization mail in a
		// mailbox the membership subquery resolves. Without it the unscoped list
		// would be filtered by nothing at all.
		expect(query.sql).toContain('"messages"."user_id" = ?');
		expect(query.sql).toContain('"messages"."organization_id" = ?');
		expect(query.sql).toContain('"messages"."mailbox_id" in');
		expect(query.params).toContain("u1");
		expect(query.params).toContain("org_1");
		// No mailbox equality: that is the narrowing filter the all scope drops.
		expect(query.sql).not.toContain('"messages"."mailbox_id" = ?');
	});

	it("adds the mailbox filter on top of the access predicate when scoped", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		await get("?mailboxId=mb1");

		// The last recorded WHERE is the outer one: `messageAccessCondition`
		// records its own subquery WHEREs first, while it is being built.
		const query = new SQLiteSyncDialect().sqlToQuery(mock.wheres.at(-1) as SQL);
		// Scoping narrows; it never replaces the access predicate.
		expect(query.sql).toContain('"messages"."mailbox_id" = ?');
		expect(query.sql).toContain('"messages"."mailbox_id" in');
		expect(query.params).toContain("mb1");
		expect(query.params).toContain("u1");
		expect(query.params).toContain("org_1");
	});

	it("applies inbound/outbound, mailbox, status, read, starred and title filters", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get(
			"?direction=inbound&mailboxId=mb1&status=received&read=read&starred=true&title=Hello&limit=200&offset=-5",
		);
		const body = ((await res.json()) as any).data;
		// limit capped at 100, offset clamped to >= 0
		expect(body.limit).toBe(100);
		expect(body.offset).toBe(0);
		expect(body.messages).toEqual([]);
	});

	it("applies outbound direction and unread filter", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get("?direction=outbound&read=unread");
		expect(res.status).toBe(200);
	});

	it("accepts a comma-delimited delivery-status filter", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get("?direction=outbound&status=queued,sent,failed");
		expect(res.status).toBe(200);
	});

	it("rejects an unknown message status", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await get("?status=teleported");
		expect(res.status).toBe(400);
	});

	it("ignores unknown direction values", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get("?direction=sideways");
		expect(res.status).toBe(200);
	});

	it("applies the q text-search filter", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ total: 0 }]);
		mock.queueSelect([]);
		const res = await get("?q=hello");
		expect(res.status).toBe(200);
	});

	it("filters by labelId and returns matching messages", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([{ messageId: "m1" }, { messageId: "m2" }]); // label lookup
		mock.queueSelect([{ total: 1 }]); // count
		mock.queueSelect([{ id: "m1", snippet: "s", fromAddr: "a@x", toAddr: "b@x" }]); // rows
		const res = await get("?labelId=lbl1");
		const body = ((await res.json()) as any).data;
		expect(body.messages).toHaveLength(1);

		const labelWhere = mock.wheres
			.map((condition) => new SQLiteSyncDialect().sqlToQuery(condition as SQL))
			.find((query) => query.sql.includes('"message_labels"."label_id"'));
		expect(labelWhere?.sql).toContain('"labels"."user_id" = ?');
		expect(labelWhere?.params).toContain("u1");
	});

	it("adds thread counts with one access-scoped aggregate query", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1" });
		mock.queueSelect([{ total: 2 }]);
		mock.queueSelect([
			{ id: "m1", threadId: "thr_1", snippet: "one", fromAddr: "a@x", toAddr: "b@x" },
			{ id: "m2", threadId: null, snippet: "two", fromAddr: "c@x", toAddr: "d@x" },
		]);
		mock.queueSelect([{ threadId: "thr_1", count: 3 }]);

		const res = await get();
		const body = ((await res.json()) as any).data;
		expect(body.messages.map((message: any) => message.threadCount)).toEqual([3, 1]);

		const aggregate = mock.wheres
			.map((condition) => new SQLiteSyncDialect().sqlToQuery(condition as SQL))
			.find((query) => query.params.includes("thr_1"));
		expect(aggregate?.sql).toContain('"messages"."user_id" = ?');
		expect(aggregate?.sql).toContain('"messages"."organization_id" = ?');
		expect(aggregate?.sql).toContain('"messages"."mailbox_id" in');
		expect(aggregate?.params).toContain("u1");
		expect(aggregate?.params).toContain("org_1");
	});

	it("defaults a thread to one when the aggregate has no matching thread id", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1" });
		mock.queueSelect([{ total: 1 }]);
		mock.queueSelect([
			{ id: "m1", threadId: "thr_missing", snippet: "one", fromAddr: "a@x", toAddr: "b@x" },
		]);
		mock.queueSelect([{ threadId: null, count: 7 }]);

		const res = await get();
		const body = ((await res.json()) as any).data;
		expect(body.messages[0].threadCount).toBe(1);
	});

	it("short-circuits to an empty result when labelId has no messages", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		mock.queueSelect([]); // label lookup -> no ids
		const res = await get("?labelId=lbl1&limit=10&offset=2");
		const body = (await res.json()) as any;
		expect(body).toEqual({
			success: true,
			data: { messages: [], total: 0, limit: 10, offset: 2 },
		});
	});
});
