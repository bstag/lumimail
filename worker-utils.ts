import type { InboundQueueMessage } from "./src/lib/email/inbound";
import type { OutboundQueueMessage } from "./src/lib/email/send";

export function isInboundQueueMessage(payload: unknown): payload is InboundQueueMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"rawR2Key" in payload &&
		"from" in payload &&
		"to" in payload
	);
}

export function isOutboundQueueMessage(payload: unknown): payload is OutboundQueueMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "outbound" &&
		"jobId" in payload &&
		typeof payload.jobId === "string" &&
		payload.jobId.length > 0
	);
}

export function isOutboundDeadLetterQueue(queueName: string): boolean {
	return queueName.includes("outbound-dlq");
}
