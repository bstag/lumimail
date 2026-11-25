import { describe, expect, it } from "vitest";
import {
	isInboundQueueMessage,
	isOutboundQueueMessage,
	isPushQueueMessage,
	queueRole,
} from "../../worker-utils";

describe("queue payload guards", () => {
	it("recognizes inbound payloads", () => {
		expect(isInboundQueueMessage({ from: "a@x", to: "b@x", rawR2Key: "inbound/1.eml" })).toBe(true);
		expect(isInboundQueueMessage({ from: "a@x", to: "b@x", rawR2Key: "attachments/read" })).toBe(false);
		expect(isInboundQueueMessage({ from: 1, to: "b@x", rawR2Key: "inbound/1.eml" })).toBe(false);
		expect(isInboundQueueMessage({ kind: "outbound", jobId: "job_1" })).toBe(false);
	});

	it("selects the contract by exact queue identity", () => {
		expect(queueRole("lumimail-external-sync-dlq-staging", {})).toBe("external-sync-dlq");
		expect(queueRole("archive-lumimail-outbound-prod", {})).toBeUndefined();
		expect(queueRole("mail-outbound-dlq-test", { QUEUE_NAME_PREFIX: "mail", QUEUE_NAME_SUFFIX: "test" })).toBe("outbound-dlq");
	});

	it("recognizes only job-id outbound payloads", () => {
		expect(isOutboundQueueMessage({ kind: "outbound", jobId: "job_1" })).toBe(true);
		expect(isOutboundQueueMessage({ kind: "outbound", jobId: "" })).toBe(false);
		expect(isOutboundQueueMessage({ messageId: "old", from: "a@x", to: "b@x" })).toBe(false);
		expect(isOutboundQueueMessage(null)).toBe(false);
	});

	it("recognizes the dedicated outbound dead-letter queue", () => {
		expect(queueRole("lumimail-outbound-dlq-prod", {})).toBe("outbound-dlq");
		expect(queueRole("lumimail-outbound-prod", {})).toBe("outbound");
		expect(queueRole("lumimail-inbound-prod", {})).toBe("inbound");
	});

	it("recognizes only versioned opaque push queue payloads", () => {
		expect(isPushQueueMessage({ kind: "push-expand", version: 1, eventId: "pue_0123456789ABCDEFGHIJK" })).toBe(true);
		expect(isPushQueueMessage({ kind: "push-deliver", version: 1, deliveryId: "pudl_0123456789ABCDEFGHIJK" })).toBe(true);
		expect(isPushQueueMessage({ kind: "push-deliver", version: 2, deliveryId: "pudl_0123456789ABCDEFGHIJK" })).toBe(false);
		expect(isPushQueueMessage({ kind: "push-deliver", version: 1, deliveryId: "bad/id", subject: "secret" })).toBe(false);
	});

	it("recognizes only the isolated push dead-letter queue", () => {
		expect(queueRole("lumimail-push-dlq-prod", {})).toBe("push-dlq");
		expect(queueRole("lumimail-push-prod", {})).toBe("push");
	});
});
