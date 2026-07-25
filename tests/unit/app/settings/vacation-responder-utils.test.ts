import { describe, expect, it } from "vitest";
import {
	DEFAULT_RESPONDER,
	findResponderForMailbox,
} from "@/components/settings/vacation-responder-utils";

const responders = [
	{ mailboxId: "mb_1", subject: "Away from support" },
	{ mailboxId: "mb_2", subject: "Away from admin" },
];

describe("findResponderForMailbox", () => {
	it("returns the responder belonging to the requested mailbox", () => {
		expect(findResponderForMailbox(responders, "mb_2")?.subject).toBe("Away from admin");
	});

	it("returns null for a mailbox with no responder", () => {
		// The form must fall back to defaults rather than show another mailbox's
		// settings, which is the isolation failure this rework exists to fix.
		expect(findResponderForMailbox(responders, "mb_3")).toBeNull();
	});

	it("returns null when nothing is configured yet", () => {
		expect(findResponderForMailbox([], "mb_1")).toBeNull();
	});
});

describe("DEFAULT_RESPONDER", () => {
	it("supplies the same defaults the API applies when fields are omitted", () => {
		expect(DEFAULT_RESPONDER.subject).toBe("Out of office");
		expect(DEFAULT_RESPONDER.body).toBe(
			"I am currently out of office and will reply when I return.",
		);
	});
});
