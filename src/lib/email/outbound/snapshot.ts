/**
 * The producer/consumer contract for durable outbound delivery (F54/F55).
 *
 * `sendEmail` persists an `OutboundDeliverySnapshot` as the immutable job
 * payload; `processOutboundQueue` re-validates it structurally with
 * `parseDeliverySnapshot` before any provider call, so a corrupted or
 * tampered stored payload fails the job instead of being delivered.
 */
import { MAX_ATTACHMENT_COUNT } from "@/lib/email/outbound-attachments";
import {
	buildReplyThreading,
	normalizeRfcMessageId,
	type ReplyThreading,
} from "@/lib/email/threading";

export type OutboundAttachmentSnapshot = {
	id: string;
	filename: string;
	contentType: string;
	size: number;
	r2Key: string;
	disposition?: "attachment" | "inline";
	contentId?: string;
};

export type OutboundDeliverySnapshot = {
	from: string;
	to: string;
	subject: string;
	html?: string;
	text?: string;
	attachments?: OutboundAttachmentSnapshot[];
	headers?: NonNullable<ReplyThreading["headers"]>;
	autoReply?: boolean;
	externalAccountId?: string;
};

export type OutboundQueueMessage = {
	kind: "outbound";
	jobId: string;
};

export function parseDeliverySnapshot(payload: string): OutboundDeliverySnapshot | null {
	try {
		const value = JSON.parse(payload) as Record<string, unknown>;
		if (
			typeof value !== "object" ||
			value === null ||
			typeof value.from !== "string" ||
			typeof value.to !== "string" ||
			typeof value.subject !== "string" ||
			(value.html !== undefined && typeof value.html !== "string") ||
			(value.text !== undefined && typeof value.text !== "string") ||
			(value.headers !== undefined && !isThreadingHeaders(value.headers)) ||
			(value.autoReply !== undefined && typeof value.autoReply !== "boolean") ||
			(value.attachments !== undefined && !isAttachmentSnapshotArray(value.attachments)) ||
			(value.externalAccountId !== undefined && (
				typeof value.externalAccountId !== "string"
				|| value.externalAccountId.length < 1
				|| value.externalAccountId.length > 100
			))
		) {
			return null;
		}
		return {
			from: value.from,
			to: value.to,
			subject: value.subject,
			html: value.html as string | undefined,
			text: value.text as string | undefined,
			headers: value.headers as NonNullable<ReplyThreading["headers"]> | undefined,
			autoReply: value.autoReply as boolean | undefined,
			externalAccountId: value.externalAccountId as string | undefined,
			attachments: value.attachments as OutboundAttachmentSnapshot[] | undefined,
		};
	} catch {
		return null;
	}
}

function isThreadingHeaders(value: unknown): value is NonNullable<ReplyThreading["headers"]> {
	if (typeof value !== "object" || value === null) return false;
	const headers = value as Record<string, unknown>;
	return (
		typeof headers["In-Reply-To"] === "string"
		&& typeof headers.References === "string"
		&& normalizeRfcMessageId(headers["In-Reply-To"]) === headers["In-Reply-To"]
		&& buildReplyThreading({
			rfcMessageId: headers["In-Reply-To"],
			providerMessageId: null,
			referencesHeader: headers.References,
		}).referencesHeader === headers.References
	);
}

function isAttachmentSnapshotArray(value: unknown): value is OutboundAttachmentSnapshot[] {
	return Array.isArray(value) && value.length <= MAX_ATTACHMENT_COUNT && value.every((attachment) =>
		typeof attachment === "object" &&
		attachment !== null &&
		typeof attachment.id === "string" &&
		typeof attachment.filename === "string" &&
		typeof attachment.contentType === "string" &&
		typeof attachment.size === "number" &&
		Number.isInteger(attachment.size) &&
		attachment.size >= 0 &&
		typeof attachment.r2Key === "string"
		&& (
			attachment.disposition === undefined
			|| attachment.disposition === "attachment"
			|| attachment.disposition === "inline"
		)
		&& (attachment.contentId === undefined || typeof attachment.contentId === "string")
	);
}
