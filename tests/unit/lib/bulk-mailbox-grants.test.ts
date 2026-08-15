import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	current: { id: "sess_current", organizationId: "org_1", tokenLookup: "lookup" } as null | {
		id: string; organizationId: string | null; tokenLookup: string;
	},
	nextId: 0,
}));
vi.mock("@/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/db")>();
	return { ...actual, getDb: () => h.db };
});
vi.mock("@/lib/auth/recent-auth", () => ({
	readRecentlyAuthenticatedSession: vi.fn(async () => h.current),
}));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix}_${++h.nextId}` }));

import { grantMailboxAccessBulk } from "@/lib/bulk-mailbox-grants";

const env = {} as CloudflareEnv;
const now = new Date("2026-08-12T22:00:00.000Z");
let mock: DbMock;

function args(overrides: Partial<Parameters<typeof grantMailboxAccessBulk>[1]> = {}) {
	return {
		organizationId: "org_1",
		actorUserId: "usr_owner",
		currentToken: "token",
		targetUserId: "usr_member",
		mailboxIds: ["mbx_1", "mbx_2"],
		role: "responder" as const,
		requestId: "req_1",
		now,
		...overrides,
	};
}

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
	h.current = { id: "sess_current", organizationId: "org_1", tokenLookup: "lookup" };
	h.nextId = 0;
});

describe("grantMailboxAccessBulk", () => {
	it("requires a recent exact owner session in the active organization before target reads", async () => {
		h.current = null;
		expect(await grantMailboxAccessBulk(env, args())).toEqual({ status: "recent-auth-required" });
		h.current = { id: "sess_current", organizationId: "org_other", tokenLookup: "lookup" };
		expect(await grantMailboxAccessBulk(env, args())).toEqual({ status: "recent-auth-required" });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("returns one not-found outcome for an absent member or incomplete mailbox set", async () => {
		mock.queueSelect([]);
		expect(await grantMailboxAccessBulk(env, args())).toEqual({ status: "not-found" });
		expect(mock.db.batch).not.toHaveBeenCalled();

		mock = createDbMock();
		h.db = mock.db;
		mock.queueSelect([{ userId: "usr_member" }]).queueSelect([{ id: "mbx_1" }]);
		expect(await grantMailboxAccessBulk(env, args())).toEqual({ status: "not-found" });
		expect(mock.db.batch).not.toHaveBeenCalled();
	});

	it("preserves existing grants and batches only missing memberships with one minimized audit event", async () => {
		mock
			.queueSelect([{ userId: "usr_member" }])
			.queueSelect([{ id: "mbx_1" }, { id: "mbx_2" }])
			.queueSelect([{ mailboxId: "mbx_1" }]);

		expect(await grantMailboxAccessBulk(env, args())).toEqual({
			status: "granted", createdCount: 1, requestId: "req_1",
		});
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
		expect(mock.inserts).toHaveLength(2);
		expect(mock.inserts[0].values).toMatchObject({
			id: "mbm_1", mailboxId: "mbx_2", userId: "usr_member", role: "responder",
		});
		expect(mock.inserts[1].values).toEqual({
			id: "aud_2", organizationId: "org_1", actorUserId: "usr_owner",
			action: "mailbox.grant_bulk", resourceType: "mailbox_membership",
			resourceId: "usr_member", affectedCount: 1, requestId: "req_1",
			outcome: "succeeded", createdAt: now,
		});
		expect(Object.keys(mock.inserts[1].values as Record<string, unknown>)).not.toEqual(expect.arrayContaining([
			"token", "password", "email", "address", "ipAddress", "userAgent", "body", "message",
		]));
	});

	it("records an idempotent zero-change action without replacing an existing role", async () => {
		mock
			.queueSelect([{ userId: "usr_member" }])
			.queueSelect([{ id: "mbx_1" }, { id: "mbx_2" }])
			.queueSelect([{ mailboxId: "mbx_1" }, { mailboxId: "mbx_2" }]);
		expect(await grantMailboxAccessBulk(env, args({ role: "manager" }))).toEqual({
			status: "granted", createdCount: 0, requestId: "req_1",
		});
		expect(mock.inserts).toHaveLength(1);
		expect(mock.inserts[0].values).toMatchObject({ affectedCount: 0 });
	});

	it("uses the current time when no clock is injected and propagates an atomic batch failure", async () => {
		mock.queueSelect([{ userId: "usr_member" }]).queueSelect([{ id: "mbx_1" }, { id: "mbx_2" }]).queueSelect([]);
		mock.db.batch.mockRejectedValueOnce(new Error("D1 conflict"));
		await expect(grantMailboxAccessBulk(env, args({ now: undefined }))).rejects.toThrow("D1 conflict");
		expect(mock.inserts.at(-1)?.values).toMatchObject({ createdAt: expect.any(Date) });
	});
});
