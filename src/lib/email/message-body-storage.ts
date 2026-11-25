import { Buffer } from "node:buffer";
import { htmlToReadableText } from "@/lib/email/reply-content-utils";
import type { PreparedInboundAttachment } from "@/lib/email/inbound-attachments";

// D1 limits the entire row to 2,000,000 bytes. Leave room for all other columns.
const INLINE_BODY_BYTES = 1_600_000;
const PREVIEW_CHARS = 64_000;

function bodyDownload(value: string | null, format: "txt" | "html"): PreparedInboundAttachment[] {
	if (!value) return [];
	const content = new TextEncoder().encode(value);
	return [{
		filename: `message-body.${format}`,
		contentType: format === "txt" ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
		size: content.byteLength,
		content: content.buffer,
		disposition: "attachment",
		contentId: null,
	}];
}

export function prepareMessageBody(textBody: string | null, htmlBody: string | null) {
	if (Buffer.byteLength(textBody ?? "") + Buffer.byteLength(htmlBody ?? "") <= INLINE_BODY_BYTES) {
		return { textBody, htmlBody, overflow: [] };
	}
	const preview = textBody ?? htmlToReadableText(htmlBody?.slice(0, PREVIEW_CHARS)).trimStart();
	return {
		textBody: `${preview.slice(0, PREVIEW_CHARS)}\n\n[Full message body available in the attachments.]`,
		htmlBody: null,
		overflow: [...bodyDownload(textBody, "txt"), ...bodyDownload(htmlBody, "html")],
	};
}
