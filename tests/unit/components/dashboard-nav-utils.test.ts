import { describe, expect, it } from "vitest";
import type { CountedFolder, MessageCounts } from "@/hooks/types";
import { getFolderNavCount } from "@/components/dashboard-nav-utils";

function counts(unread: number): MessageCounts["folders"] {
	const folder = { total: 0, unread };
	return {
		inbox: folder,
		sent: folder,
		drafts: folder,
		archived: folder,
		trash: folder,
		spam: folder,
		starred: folder,
	} satisfies Record<CountedFolder, { total: number; unread: number }>;
}

describe("getFolderNavCount", () => {
	it("returns the unread count for the inbox folder", () => {
		expect(getFolderNavCount("inbox", counts(3))).toBe(3);
	});

	it("returns the unread count for the spam folder", () => {
		expect(getFolderNavCount("spam", counts(5))).toBe(5);
	});

	it("returns undefined for other folders", () => {
		expect(getFolderNavCount("sent", counts(2))).toBeUndefined();
		expect(getFolderNavCount("drafts", counts(2))).toBeUndefined();
		expect(getFolderNavCount("trash", counts(2))).toBeUndefined();
		expect(getFolderNavCount("starred", counts(2))).toBeUndefined();
		expect(getFolderNavCount("archived", counts(2))).toBeUndefined();
	});
});
