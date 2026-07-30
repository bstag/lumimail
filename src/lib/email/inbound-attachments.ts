import type { ParsedAttachment } from "@/lib/email/parse";
import { sanitizeAttachmentFilename } from "@/lib/email/attachment-storage";

export const MAX_INBOUND_ATTACHMENT_COUNT = 50;
export const MAX_INBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const INBOUND_ATTACHMENT_OMISSION_MESSAGE =
	"Attachments were omitted because this message exceeded Lumimail's safe ingestion limits.";

export type PreparedInboundAttachment = {
	filename: string;
	contentType: string;
	size: number;
	content: ArrayBuffer;
	disposition: "attachment" | "inline";
	contentId: string | null;
};

export type PreparedInboundAttachments = {
	status: "none" | "stored" | "omitted";
	error: string | null;
	attachments: PreparedInboundAttachment[];
};

function sanitizeContentType(value: string): string {
	const normalized = value.trim().toLowerCase();
	return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
		? normalized
		: "application/octet-stream";
}

function sanitizeContentId(value: string | null): string | null {
	const normalized = (value ?? "").trim().replace(/^<|>$/g, "");
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized) ? normalized : null;
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
		const contentType = sanitizeContentType(value.contentType);
		const contentId = sanitizeContentId(value.contentId);
		attachments.push({
			filename: sanitizeAttachmentFilename(value.filename),
			contentType,
			size,
			content: value.content,
			disposition:
				value.disposition === "inline" && contentType.startsWith("image/") && contentId
					? "inline"
					: "attachment",
			contentId,
		});
	}

	return { status: "stored", error: null, attachments };
}
