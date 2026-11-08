import { describe, expect, it } from "vitest";
import { INBOX_FOCUS_KEY, parseInboxFocus } from "@/components/messages/inbox-focus-utils";

describe("inbox focus preference (F97)", () => {
	it("defaults to Focused for missing or unknown stored values", () => {
		expect(parseInboxFocus("other")).toBe("other");
		expect(parseInboxFocus("focused")).toBe("focused");
		expect(parseInboxFocus(null)).toBe("focused");
		expect(parseInboxFocus("bulk")).toBe("focused");
		expect(INBOX_FOCUS_KEY).toBe("picket:inbox-focus");
	});
});
