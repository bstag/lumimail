import type { InboundQueueMessage } from "./src/lib/email/inbound";
import type { OutboundQueueMessage } from "./src/lib/email/send";

export type PushQueueMessage =
	| { kind: "push-expand"; version: 1; eventId: string }
	| { kind: "push-deliver"; version: 1; deliveryId: string };

const PUSH_EVENT_ID = /^pue_[A-Za-z0-9_-]{21}$/;
const PUSH_DELIVERY_ID = /^pudl_[A-Za-z0-9_-]{21}$/;

export function isInboundQueueMessage(payload: unknown): payload is InboundQueueMessage {
	if (!payload || typeof payload !== "object") return false;
	const { rawR2Key, from, to, headers } = payload as Record<string, unknown>;
	return typeof from === "string" && from.length <= 512
		&& typeof to === "string" && to.length > 0 && to.length <= 512
		&& typeof rawR2Key === "string" && /^inbound\/[A-Za-z0-9_-]{1,100}\.eml$/.test(rawR2Key)
		&& (headers === undefined || (headers !== null && typeof headers === "object" && !Array.isArray(headers)
			&& Object.values(headers).every((value) => typeof value === "string")));
}

export function isOutboundQueueMessage(payload: unknown): payload is OutboundQueueMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "outbound" &&
		"jobId" in payload &&
		typeof payload.jobId === "string" &&
		payload.jobId.length > 0 && payload.jobId.length <= 120 &&
		(!("generation" in payload) || (typeof payload.generation === "number"
			&& Number.isSafeInteger(payload.generation) && payload.generation >= 0))
	);
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

const QUEUE_ROLES = ["inbound", "outbound", "outbound-dlq", "push", "push-dlq", "external-sync", "external-sync-dlq"] as const;

export function queueRole(name: string, env: { QUEUE_NAME_PREFIX?: string; QUEUE_NAME_SUFFIX?: string }) {
	const prefix = env.QUEUE_NAME_PREFIX ?? "lumimail";
	const suffixes = env.QUEUE_NAME_SUFFIX === undefined ? ["", "-prod", "-staging"] : [`-${env.QUEUE_NAME_SUFFIX}`];
	return QUEUE_ROLES.find((role) => suffixes.some((suffix) => name === `${prefix}-${role}${suffix}`));
}

export function inboundQueueHeaders(headers: Headers): Record<string, string> {
	const compact: Record<string, string> = {};
	for (const name of ["auto-submitted", "precedence", "x-auto-response-suppress"]) {
		const value = headers.get(name);
		if (value) compact[name] = value.slice(0, 256);
	}
	if ([...headers.keys()].some((name) => name.startsWith("list-"))) compact["list-id"] = "present";
	return compact;
}
