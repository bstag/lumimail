import { describe, expect, it } from "vitest";
import { getMessageQueryParams } from "@/hooks/utils";
import { getMessageBackHref } from "@/components/message-actions/utils";
import { getMessagesRefetchInterval } from "@/components/messages/message-folder-utils";
import { getFolderNavCount } from "@/components/dashboard-nav-utils";
import { createEmptyFolderCounts } from "@/app/api/messages/counts/utils";

/**
 * Regression cover for F04's 2026-07-31 entry: three shipped controls wrote
 * `status = "archived"` and nothing read it back, so archived mail left the
 * product entirely. These pin the read path.
 */
describe("archive folder", () => {
	it("requests archived rows in either direction", () => {
		const params = getMessageQueryParams("archived", "mb_1");
		expect(params.get("status")).toBe("archived");
		// Archive holds both inbound and outbound mail, so it must not constrain
		// direction the way Inbox and Sent do.
		expect(params.get("direction")).toBeNull();
		expect(params.get("mailboxId")).toBe("mb_1");
	});

	it("sends an archived message's back link to the archive, not the inbox", () => {
		expect(getMessageBackHref("inbound", "archived")).toBe("/archive");
		expect(getMessageBackHref("outbound", "archived")).toBe("/archive");
		// Unchanged for every other status.
		expect(getMessageBackHref("inbound", "received")).toBe("/inbox");
		expect(getMessageBackHref("outbound", "sent")).toBe("/sent");
		expect(getMessageBackHref("inbound", "trash")).toBe("/trash");
	});

	it("does not poll the archive list", () => {
		expect(getMessagesRefetchInterval("archived", ["archived"])).toBe(false);
	});

	it("shows no nav badge for the archive", () => {
		const counts = { ...createEmptyFolderCounts(), archived: { total: 4, unread: 2 } };
		// Only Inbox and Spam carry an unread badge; Archive is a destination the
		// user files into deliberately, not something demanding attention.
		expect(getFolderNavCount("archived", counts)).toBeUndefined();
	});
});
