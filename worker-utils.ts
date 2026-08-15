import type { InboundQueueMessage } from "./src/lib/email/inbound";
import type { OutboundQueueMessage } from "./src/lib/email/send";

export type PushQueueMessage =
	| { kind: "push-expand"; version: 1; eventId: string }
	| { kind: "push-deliver"; version: 1; deliveryId: string };

const PUSH_EVENT_ID = /^pue_[A-Za-z0-9_-]{21}$/;
const PUSH_DELIVERY_ID = /^pudl_[A-Za-z0-9_-]{21}$/;

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

export function isPushQueueMessage(payload: unknown): payload is PushQueueMessage {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
	const value = payload as Record<string, unknown>;
	if (value.version !== 1 || typeof value.kind !== "string") return false;
	if (value.kind === "push-expand") {
		return Object.keys(value).length === 3
			&& typeof value.eventId === "string"
			&& PUSH_EVENT_ID.test(value.eventId);
	}
	if (value.kind === "push-deliver") {
		return Object.keys(value).length === 3
			&& typeof value.deliveryId === "string"
			&& PUSH_DELIVERY_ID.test(value.deliveryId);
	}
	return false;
}

export function isPushDeadLetterQueue(queueName: string): boolean {
	return queueName.includes("push-dlq");
}
