import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
}));
vi.mock("@/db", () => ({ getDb: () => m.db }));

import { updateMessageForImap } from "@/lib/email/imap-state";
import { messages } from "@/db/schema";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
});

describe("updateMessageForImap", () => {
	it("returns null without mutating when mailbox access finds no message", async () => {
		mock.queueSelect([]);

		await expect(
			updateMessageForImap({} as CloudflareEnv, "u1", "o1", "missing", "mb1", { read: true }),
		).resolves.toBeNull();
		expect(mock.updates).toHaveLength(0);
	});

	it("returns the persisted state change", async () => {
		mock.queueSelect([{ id: "msg1", read: true, status: "received" }])
			.queueSelect([{ id: "msg1", read: false, status: "trash" }]);

		await expect(
			updateMessageForImap({} as CloudflareEnv, "u1", "o1", "msg1", "mb1", {
				read: false,
				status: "trash",
			}),
		).resolves.toEqual({ id: "msg1", read: false, status: "trash" });
		expect(mock.updates).toContainEqual({
			table: messages,
			set: { read: false, status: "trash" },
		});
	});

	it("falls back to the authorized row when the update adapter returns no row", async () => {
		mock.queueSelect([{ id: "msg1", read: false, status: "received" }]).queueSelect([]);

		await expect(
			updateMessageForImap({} as CloudflareEnv, "u1", null, "msg1", "mb1", { read: true }),
		).resolves.toEqual({ id: "msg1", read: true, status: "received" });
	});
});
