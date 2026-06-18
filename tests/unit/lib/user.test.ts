import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import {
	getPrimaryDomain,
	getPrimaryDomainForOrg,
	markMessageAsRead,
	updateMessageStatus,
	userHasMailboxes,
} from "@/lib/user";

const env = {} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
});

describe("userHasMailboxes", () => {
	it("returns false when the user does not exist", async () => {
		mock.queueSelect([]);
		expect(await userHasMailboxes(env, "u1")).toBe(false);
	});

	it("checks org mailboxes for an org user", async () => {
		mock.queueSelect([{ organizationId: "org_1" }]).queueSelect([{ id: "mb_1" }]);
		expect(await userHasMailboxes(env, "u1")).toBe(true);
	});

	it("returns false when an org user has no mailboxes", async () => {
		mock.queueSelect([{ organizationId: "org_1" }]).queueSelect([]);
		expect(await userHasMailboxes(env, "u1")).toBe(false);
	});

	it("checks personal mailboxes for a non-org user", async () => {
		mock.queueSelect([{ organizationId: null }]).queueSelect([{ id: "mb_1" }]);
		expect(await userHasMailboxes(env, "u1")).toBe(true);
	});

	it("returns false when a non-org user has no mailboxes", async () => {
		mock.queueSelect([{ organizationId: null }]).queueSelect([]);
		expect(await userHasMailboxes(env, "u1")).toBe(false);
	});
});

describe("getPrimaryDomain", () => {
	it("returns the first domain", async () => {
		mock.queueSelect([{ id: "dom_1" }]);
		expect(await getPrimaryDomain(env)).toEqual({ id: "dom_1" });
	});

	it("returns null when there are no domains", async () => {
		mock.queueSelect([]);
		expect(await getPrimaryDomain(env)).toBeNull();
	});
});

describe("getPrimaryDomainForOrg", () => {
	it("returns the org's first domain", async () => {
		mock.queueSelect([{ id: "dom_1" }]);
		expect(await getPrimaryDomainForOrg(env, "org_1")).toEqual({ id: "dom_1" });
	});

	it("returns null when the org has no domains", async () => {
		mock.queueSelect([]);
		expect(await getPrimaryDomainForOrg(env, "org_1")).toBeNull();
	});
});

describe("markMessageAsRead", () => {
	it("returns false when the message is missing", async () => {
		mock.queueSelect([]);
		expect(await markMessageAsRead(env, "u1", "msg_1")).toBe(false);
		expect(mock.updates).toHaveLength(0);
	});

	it("returns false when the message belongs to another user", async () => {
		mock.queueSelect([{ id: "msg_1", userId: "other" }]);
		expect(await markMessageAsRead(env, "u1", "msg_1")).toBe(false);
		expect(mock.updates).toHaveLength(0);
	});

	it("marks the message read and returns true", async () => {
		mock.queueSelect([{ id: "msg_1", userId: "u1" }]);
		expect(await markMessageAsRead(env, "u1", "msg_1")).toBe(true);
		expect(mock.updates).toEqual([{ table: expect.anything(), set: { read: true } }]);
	});
});

describe("updateMessageStatus", () => {
	it("returns false when the message is missing", async () => {
		mock.queueSelect([]);
		expect(await updateMessageStatus(env, "u1", "msg_1", "spam")).toBe(false);
		expect(mock.updates).toHaveLength(0);
	});

	it("returns false when the message belongs to another user", async () => {
		mock.queueSelect([{ id: "msg_1", userId: "other" }]);
		expect(await updateMessageStatus(env, "u1", "msg_1", "spam")).toBe(false);
	});

	it("updates the status and returns true", async () => {
		mock.queueSelect([{ id: "msg_1", userId: "u1" }]);
		expect(await updateMessageStatus(env, "u1", "msg_1", "spam")).toBe(true);
		expect(mock.updates).toEqual([{ table: expect.anything(), set: { status: "spam" } }]);
	});
});
