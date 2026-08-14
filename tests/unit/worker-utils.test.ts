import { describe, expect, it } from "vitest";
import {
	isInboundQueueMessage,
	isOutboundDeadLetterQueue,
	isOutboundQueueMessage,
	isPushDeadLetterQueue,
	isPushQueueMessage,
} from "../../worker-utils";

describe("queue payload guards", () => {
	it("recognizes inbound payloads", () => {
		expect(isInboundQueueMessage({ from: "a@x", to: "b@x", rawR2Key: "raw/1" })).toBe(true);
		expect(isInboundQueueMessage({ kind: "outbound", jobId: "job_1" })).toBe(false);
	});

	it("recognizes only job-id outbound payloads", () => {
		expect(isOutboundQueueMessage({ kind: "outbound", jobId: "job_1" })).toBe(true);
		expect(isOutboundQueueMessage({ kind: "outbound", jobId: "" })).toBe(false);
		expect(isOutboundQueueMessage({ messageId: "old", from: "a@x", to: "b@x" })).toBe(false);
		expect(isOutboundQueueMessage(null)).toBe(false);
	});

	it("recognizes the dedicated outbound dead-letter queue", () => {
		expect(isOutboundDeadLetterQueue("lumimail-outbound-dlq-prod")).toBe(true);
		expect(isOutboundDeadLetterQueue("lumimail-outbound-prod")).toBe(false);
		expect(isOutboundDeadLetterQueue("lumimail-inbound-prod")).toBe(false);
	});

	it("recognizes only versioned opaque push queue payloads", () => {
		expect(isPushQueueMessage({ kind: "push-expand", version: 1, eventId: "pue_0123456789ABCDEFGHIJK" })).toBe(true);
		expect(isPushQueueMessage({ kind: "push-deliver", version: 1, deliveryId: "pudl_0123456789ABCDEFGHIJK" })).toBe(true);
		expect(isPushQueueMessage({ kind: "push-deliver", version: 2, deliveryId: "pudl_0123456789ABCDEFGHIJK" })).toBe(false);
		expect(isPushQueueMessage({ kind: "push-deliver", version: 1, deliveryId: "bad/id", subject: "secret" })).toBe(false);
	});

	it("recognizes only the isolated push dead-letter queue", () => {
		expect(isPushDeadLetterQueue("lumimail-push-dlq-prod")).toBe(true);
		expect(isPushDeadLetterQueue("lumimail-push-prod")).toBe(false);
		expect(isPushDeadLetterQueue("lumimail-outbound-dlq-prod")).toBe(false);
	});
});
