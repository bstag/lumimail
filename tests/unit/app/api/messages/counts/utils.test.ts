import { describe, expect, it } from "vitest";
import {
	buildMessageCounts,
	createEmptyFolderCounts,
	getFolderLabelCount,
	getMessageFolder,
} from "@/app/api/messages/counts/utils";
import type { MessageCountRow } from "@/app/api/messages/counts/types";

const row = (overrides: Partial<MessageCountRow>): MessageCountRow => ({
	mailboxId: "mb_1",
	direction: "inbound",
	status: "received",
	read: false,
	...overrides,
});

describe("getMessageFolder", () => {
	it("classifies trash and spam regardless of direction", () => {
		expect(getMessageFolder(row({ status: "trash" }))).toBe("trash");
		expect(getMessageFolder(row({ status: "spam" }))).toBe("spam");
	});

	it("classifies inbound received as inbox", () => {
		expect(getMessageFolder(row({ direction: "inbound", status: "received" }))).toBe("inbox");
	});

	it("classifies outbound sent as sent", () => {
		expect(getMessageFolder(row({ direction: "outbound", status: "sent" }))).toBe("sent");
	});

	it("classifies outbound draft as drafts", () => {
		expect(getMessageFolder(row({ direction: "outbound", status: "draft" }))).toBe("drafts");
	});

	it("returns null for rows that match no folder", () => {
		expect(getMessageFolder(row({ direction: "inbound", status: "sent" }))).toBeNull();
		expect(getMessageFolder(row({ direction: "outbound", status: "received" }))).toBeNull();
		expect(getMessageFolder(row({ direction: "outbound", status: "queued" }))).toBeNull();
	});
});

describe("createEmptyFolderCounts", () => {
	it("returns all folders at zero", () => {
		expect(createEmptyFolderCounts()).toEqual({
			inbox: { total: 0, unread: 0 },
			sent: { total: 0, unread: 0 },
			drafts: { total: 0, unread: 0 },
			spam: { total: 0, unread: 0 },
			trash: { total: 0, unread: 0 },
			starred: { total: 0, unread: 0 },
		});
	});
});

describe("buildMessageCounts", () => {
	it("aggregates folder and mailbox counts including unread and inbox", () => {
		const result = buildMessageCounts([
			row({ mailboxId: "mb_1", direction: "inbound", status: "received", read: false }),
			row({ mailboxId: "mb_1", direction: "inbound", status: "received", read: true }),
			row({ mailboxId: "mb_1", direction: "outbound", status: "sent", read: true }),
			row({ mailboxId: "mb_2", direction: "inbound", status: "spam", read: false }),
		]);

		expect(result.folders.inbox).toEqual({ total: 2, unread: 1 });
		expect(result.folders.sent).toEqual({ total: 1, unread: 0 });
		expect(result.folders.spam).toEqual({ total: 1, unread: 1 });
		expect(result.mailboxes).toEqual([
			{ mailboxId: "mb_1", total: 3, unread: 1, inbox: 2 },
			{ mailboxId: "mb_2", total: 1, unread: 1, inbox: 0 },
		]);
	});

	it("skips mailbox aggregation when mailboxId is null", () => {
		const result = buildMessageCounts([
			row({ mailboxId: null, direction: "inbound", status: "received", read: false }),
		]);

		expect(result.folders.inbox).toEqual({ total: 1, unread: 1 });
		expect(result.mailboxes).toEqual([]);
	});

	it("counts mailbox rows that map to no folder", () => {
		const result = buildMessageCounts([
			row({ mailboxId: "mb_3", direction: "outbound", status: "queued", read: true }),
		]);

		expect(result.folders.inbox).toEqual({ total: 0, unread: 0 });
		expect(result.mailboxes).toEqual([
			{ mailboxId: "mb_3", total: 1, unread: 0, inbox: 0 },
		]);
	});
});

describe("getFolderLabelCount", () => {
	const counts = createEmptyFolderCounts();

	it("prefers unread for inbox and spam, falling back to total", () => {
		expect(getFolderLabelCount("inbox", { ...counts, inbox: { total: 5, unread: 2 } })).toBe(2);
		expect(getFolderLabelCount("inbox", { ...counts, inbox: { total: 5, unread: 0 } })).toBe(5);
		expect(getFolderLabelCount("spam", { ...counts, spam: { total: 3, unread: 1 } })).toBe(1);
		expect(getFolderLabelCount("spam", { ...counts, spam: { total: 3, unread: 0 } })).toBe(3);
	});

	it("returns total for other folders", () => {
		expect(getFolderLabelCount("sent", { ...counts, sent: { total: 9, unread: 4 } })).toBe(9);
		expect(getFolderLabelCount("drafts", { ...counts, drafts: { total: 2, unread: 1 } })).toBe(2);
	});
});
