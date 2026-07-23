import { beforeEach, describe, expect, it } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";
import { allocateImapUid, reserveImapUid } from "@/lib/email/imap-uid";
import { messages } from "@/db/schema";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
});

describe("allocateImapUid", () => {
	it("returns an already assigned UID without advancing the allocator", async () => {
		mock.queueSelect([{ imapUid: 81 }]);

		await expect(allocateImapUid(mock.db, "msg1")).resolves.toBe(81);
		expect(mock.updates).toHaveLength(0);
	});

	it("atomically allocates and persists a positive UID", async () => {
		mock
			.queueSelect([])
			.queueSelect([{ value: 82 }])
			.queueSelect([{ imapUid: 82 }]);

		await expect(allocateImapUid(mock.db, "msg1")).resolves.toBe(82);
		expect(mock.updates).toContainEqual({
			table: messages,
			set: { imapUid: 82 },
		});
	});

	it("uses the winning persisted UID when concurrent allocation races", async () => {
		mock
			.queueSelect([])
			.queueSelect([{ value: 83 }])
			.queueSelect([])
			.queueSelect([{ imapUid: 84 }]);

		await expect(allocateImapUid(mock.db, "msg1")).resolves.toBe(84);
	});

	it("fails when the message does not exist or cannot retain a UID", async () => {
		mock.queueSelect([]).queueSelect([{ value: 85 }]).queueSelect([]).queueSelect([]);

		await expect(allocateImapUid(mock.db, "missing")).rejects.toThrow("Unable to allocate IMAP UID");
	});

	it.each([
		{ rows: [] },
		{ rows: [{ value: 0 }] },
		{ rows: [{ value: 2_147_483_648 }] },
	])("fails closed for an unavailable or invalid allocator result", async ({ rows }) => {
		mock.queueSelect(rows);
		await expect(reserveImapUid(mock.db)).rejects.toThrow("IMAP UID space exhausted");
	});
});
