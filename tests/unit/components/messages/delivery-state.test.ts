import { describe, expect, it } from "vitest";
import { getMessageQueryParams } from "@/hooks/utils";
import { getMessageBadge } from "@/components/messages/utils";
import { shouldRefreshDeliveryStatus } from "@/components/messages/message-folder-utils";
import type { Message } from "@/hooks/types";

const baseMessage = {
	id: "msg_1",
	userId: "u1",
	mailboxId: "mb_1",
	direction: "outbound",
	providerMessageId: null,
	fromAddr: "a@example.com",
	toAddr: "b@example.com",
	subject: "Hello",
	snippet: "Body",
	status: "queued",
	read: true,
	starred: false,
	threadId: null,
	createdAt: "2026-07-24T00:00:00.000Z",
} satisfies Message;

describe("outbound delivery state UI", () => {
	it("requests queued, sent, and failed rows for the Sent folder", () => {
		const params = getMessageQueryParams("sent", "mb_1");
		expect(params.get("direction")).toBe("outbound");
		expect(params.get("status")).toBe("queued,sent,failed");
	});

	it.each(["queued", "sent", "failed"] as const)("shows %s as the Sent-row badge", (status) => {
		expect(getMessageBadge({ ...baseMessage, status }, "sent")).toBe(status);
	});

	it("refreshes a visible Sent page only while queued work is present", () => {
		expect(shouldRefreshDeliveryStatus("sent", "visible", ["sent", "queued"])).toBe(true);
		expect(shouldRefreshDeliveryStatus("sent", "visible", ["sent", "failed"])).toBe(false);
		expect(shouldRefreshDeliveryStatus("sent", "hidden", ["queued"])).toBe(false);
		expect(shouldRefreshDeliveryStatus("inbox", "visible", ["queued"])).toBe(false);
	});
});
