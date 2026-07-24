import type { ParsedAttachment } from "@/lib/email/parse";

export const MAX_INBOUND_ATTACHMENT_COUNT = 50;
export const MAX_INBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const INBOUND_ATTACHMENT_OMISSION_MESSAGE =
	"Attachments were omitted because this message exceeded Lumimail's safe ingestion limits.";

export type PreparedInboundAttachment = {
	filename: string;
	contentType: string;
	size: number;
	content: ArrayBuffer;
};

export type PreparedInboundAttachments = {
	status: "none" | "stored" | "omitted";
	error: string | null;
	attachments: PreparedInboundAttachment[];
};

function sanitizeFilename(value: string | null): string {
	const leaf = (value ?? "")
		.replaceAll("\\", "/")
		.split("/")
		.at(-1)
		?.replace(/[\u0000-\u001f\u007f]/g, "")
		.trim()
		.slice(0, 255);
	return leaf || "attachment";
}

function sanitizeContentType(value: string): string {
	const normalized = value.trim().toLowerCase();
	return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
		? normalized
		: "application/octet-stream";
}

function omitted(): PreparedInboundAttachments {
	return {
		status: "omitted",
		error: INBOUND_ATTACHMENT_OMISSION_MESSAGE,
		attachments: [],
	};
}

export function prepareInboundAttachments(
	values: ParsedAttachment[],
): PreparedInboundAttachments {
	if (values.length === 0) {
		return { status: "none", error: null, attachments: [] };
	}
	if (values.length > MAX_INBOUND_ATTACHMENT_COUNT) return omitted();

	let total = 0;
	const attachments: PreparedInboundAttachment[] = [];
	for (const value of values) {
		const size = value.content.byteLength;
		total += size;
		if (
			size > MAX_INBOUND_ATTACHMENT_BYTES ||
			total > MAX_INBOUND_ATTACHMENT_BYTES
		) {
			return omitted();
		}
		attachments.push({
			filename: sanitizeFilename(value.filename),
			contentType: sanitizeContentType(value.contentType),
			size,
			content: value.content,
		});
	}

	return { status: "stored", error: null, attachments };
}
