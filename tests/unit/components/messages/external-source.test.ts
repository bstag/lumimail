import { describe, expect, it } from "vitest";
import { getExternalSourceLabel } from "@/components/messages/utils";

const message = {
	id: "msg_1", userId: "usr_1", mailboxId: "mbx_1", direction: "inbound" as const,
	providerMessageId: null, fromAddr: "sender@example.com", toAddr: "person@gmail.com",
	subject: "Hi", snippet: "Body", status: "received", read: false, starred: false,
	threadId: null, createdAt: new Date().toISOString(),
};

describe("external source presentation", () => {
	it("matches an address only within the mapped mailbox and labels the provider", () => {
		const accounts = [{ id: "exa_1", mailboxId: "mbx_1", provider: "google" as const, externalAddress: "PERSON@gmail.com" }];
		expect(getExternalSourceLabel(message, accounts)).toBe("Google · PERSON@gmail.com");
		expect(getExternalSourceLabel({ ...message, mailboxId: "mbx_other" }, accounts)).toBeNull();
		expect(getExternalSourceLabel({ ...message, toAddr: "other@example.com" }, accounts)).toBeNull();
	});

	it("recognizes provider-sent mail by its From address", () => {
		expect(getExternalSourceLabel({ ...message, direction: "outbound", fromAddr: "person@outlook.com", toAddr: "target@example.com" }, [
			{ id: "exa_2", mailboxId: "mbx_1", provider: "microsoft", externalAddress: "person@outlook.com" },
		])).toBe("Microsoft · person@outlook.com");
	});
});
