import { describe, expect, it } from "vitest";
import { isAllowedMessageStatus } from "@/app/api/messages/[messageId]/status/utils";

describe("isAllowedMessageStatus", () => {
	it("returns true for each allowed status", () => {
		for (const status of ["received", "sent", "draft", "trash", "spam"]) {
			expect(isAllowedMessageStatus(status)).toBe(true);
		}
	});

	it("returns false for a string that is not allowed", () => {
		expect(isAllowedMessageStatus("queued")).toBe(false);
		expect(isAllowedMessageStatus("")).toBe(false);
	});

	it("returns false for non-string values", () => {
		expect(isAllowedMessageStatus(undefined)).toBe(false);
		expect(isAllowedMessageStatus(null)).toBe(false);
		expect(isAllowedMessageStatus(42)).toBe(false);
		expect(isAllowedMessageStatus({ status: "received" })).toBe(false);
	});
});
