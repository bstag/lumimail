import { describe, expect, it } from "vitest";
import {
	DRAFTS_REFRESH_INTERVAL_MS,
	getMessagesRefetchInterval,
} from "@/components/messages/message-folder-utils";

describe("getMessagesRefetchInterval — drafts", () => {
	it("polls the drafts folder for shared-draft edits", () => {
		expect(getMessagesRefetchInterval("drafts", [])).toBe(DRAFTS_REFRESH_INTERVAL_MS);
	});

	it("polls drafts regardless of row statuses", () => {
		expect(getMessagesRefetchInterval("drafts", ["draft", "draft"])).toBe(
			DRAFTS_REFRESH_INTERVAL_MS,
		);
	});

	it.each(["inbox", "trash", "spam", "starred"] as const)(
		"does not poll the %s folder",
		(folder) => {
			expect(getMessagesRefetchInterval(folder, ["queued"])).toBe(false);
		},
	);
});
