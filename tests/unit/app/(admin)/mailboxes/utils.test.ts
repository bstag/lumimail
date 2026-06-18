import { describe, expect, it } from "vitest";
import { getMailboxAddress, getMailboxName } from "@/app/(admin)/mailboxes/utils";

describe("getMailboxAddress", () => {
	it("re-exports getMailboxAddress and builds the address", () => {
		expect(getMailboxAddress({ localPart: "alice", hostname: "example.com" })).toBe("alice@example.com");
	});
});

describe("getMailboxName", () => {
	it("returns the trimmed display name when present", () => {
		expect(getMailboxName({ displayName: "  Alice  ", localPart: "alice" })).toBe("Alice");
	});

	it("falls back to the local part when the display name is blank", () => {
		expect(getMailboxName({ displayName: "   ", localPart: "alice" })).toBe("alice");
	});

	it("falls back to the local part when the display name is null", () => {
		expect(getMailboxName({ displayName: null, localPart: "alice" })).toBe("alice");
	});
});
