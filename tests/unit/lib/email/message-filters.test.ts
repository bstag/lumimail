import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";
import { messages } from "@/db/schema";
import { applyMessageFilters } from "@/lib/email/message-filters";
import type { AppDatabase } from "@/db";

let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
});

function apply(subject: string | undefined = "Hello") {
	return applyMessageFilters(
		mock.db as AppDatabase,
		"u1",
		"msg_1",
		"sender@other.com",
		"a@example.com",
		subject,
	);
}

describe("applyMessageFilters", () => {
	it("merges the actions of every matching filter into a single update", async () => {
		mock.queueSelect([
			{ enabled: true, fromContains: "sender", actionStar: true },
			{ enabled: true, hasWords: "Hello", actionMarkRead: true, actionArchive: true },
		]);

		await apply();

		const messageUpdates = mock.updates.filter((update) => update.table === messages);
		expect(messageUpdates).toHaveLength(1);
		expect(messageUpdates[0].set).toEqual({ starred: true, read: true, status: "archived" });
	});

	it("lets a later trash action win over an earlier archive action", async () => {
		// Matches the previous sequential-update semantics: the last matching
		// filter's status write was the one that stuck.
		mock.queueSelect([
			{ enabled: true, actionArchive: true },
			{ enabled: true, actionMoveToTrash: true },
		]);

		await apply();

		expect(mock.updates[0].set).toEqual({ status: "trash" });
	});

	it("attaches the label of each matching filter idempotently", async () => {
		mock.queueSelect([
			{ enabled: true, actionLabelId: "lbl_1" },
			{ enabled: true, actionLabelId: "lbl_2" },
		]);

		await apply();

		expect(mock.updates).toHaveLength(0);
		expect(mock.inserts.map((insert) => insert.values)).toEqual([
			{ messageId: "msg_1", labelId: "lbl_1" },
			{ messageId: "msg_1", labelId: "lbl_2" },
		]);
	});

	it("writes nothing when no filter matches", async () => {
		mock.queueSelect([
			{ enabled: false, actionStar: true },
			{ enabled: true, toContains: "nomatch", actionStar: true },
		]);

		await apply(undefined);

		expect(mock.updates).toHaveLength(0);
		expect(mock.inserts).toHaveLength(0);
	});
});
