import { describe, expect, it } from "vitest";
import {
	isInboundQueueMessage,
	isOutboundDeadLetterQueue,
	isOutboundQueueMessage,
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
});
