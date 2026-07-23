import { describe, expect, it } from "vitest";
import { shouldRefreshSharedDrafts } from "@/components/messages/message-folder-utils";

describe("shouldRefreshSharedDrafts", () => {
	it("refreshes drafts while the document is visible", () => {
		expect(shouldRefreshSharedDrafts("drafts", "visible")).toBe(true);
	});

	it.each([
		["drafts", "hidden"],
		["inbox", "visible"],
		["sent", "visible"],
	] as const)("does not refresh %s while visibility is %s", (folder, visibility) => {
		expect(shouldRefreshSharedDrafts(folder, visibility)).toBe(false);
	});
});
