import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { getMailboxUpdateValues, selectMailboxForUser } from "@/app/api/mailboxes/[id]/utils";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
});

describe("selectMailboxForUser", () => {
	it("resolves to the queued mailbox row", async () => {
		mock.queueSelect([{ id: "mb_1", organizationId: "org_1" }]);
		const result = await selectMailboxForUser(mock.db as never, "org_1", "usr_1", "mb_1", ["viewer", "responder", "manager"]);
		expect(result).toEqual([{ id: "mb_1", organizationId: "org_1" }]);
	});
});

describe("getMailboxUpdateValues", () => {
	it("returns an empty object when displayName is absent", () => {
		expect(getMailboxUpdateValues({})).toEqual({});
	});

	it("trims a provided displayName", () => {
		expect(getMailboxUpdateValues({ displayName: "  Sales  " })).toEqual({ displayName: "Sales" });
	});

	it("normalizes an empty/whitespace displayName to null", () => {
		expect(getMailboxUpdateValues({ displayName: "   " })).toEqual({ displayName: null });
		expect(getMailboxUpdateValues({ displayName: "" })).toEqual({ displayName: null });
	});

	it("normalizes an explicit null displayName to null", () => {
		expect(getMailboxUpdateValues({ displayName: null })).toEqual({ displayName: null });
	});
});
