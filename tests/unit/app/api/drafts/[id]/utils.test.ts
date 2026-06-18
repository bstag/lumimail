import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { selectDraftWithBody } from "@/app/api/drafts/[id]/utils";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
});

describe("selectDraftWithBody", () => {
	it("returns the draft when it belongs to the user and is a draft", async () => {
		const draft = { id: "msg_1", userId: "u1", status: "draft", subject: "Hi" };
		mock.queueSelect([draft]);
		expect(await selectDraftWithBody(mock.db as never, "u1", "msg_1")).toEqual(draft);
	});

	it("returns null when no draft row is found", async () => {
		mock.queueSelect([]);
		expect(await selectDraftWithBody(mock.db as never, "u1", "msg_1")).toBeNull();
	});

	it("returns null when the draft belongs to another user", async () => {
		mock.queueSelect([{ id: "msg_1", userId: "other", status: "draft" }]);
		expect(await selectDraftWithBody(mock.db as never, "u1", "msg_1")).toBeNull();
	});

	it("returns null when the message is not a draft", async () => {
		mock.queueSelect([{ id: "msg_1", userId: "u1", status: "sent" }]);
		expect(await selectDraftWithBody(mock.db as never, "u1", "msg_1")).toBeNull();
	});
});
