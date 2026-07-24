import PostalMime from "postal-mime";
import { formatPostalAddress, formatPostalAddressList } from "@/lib/email/address";
import { sanitizeHtml } from "@/lib/email/sanitize";
import { getLatestEmailContent, htmlToReadableText } from "@/lib/email/reply-content-utils";

export type ParsedEmail = {
	subject: string | null;
	text: string | null;
	html: string | null;
	messageId: string | null;
	inReplyTo: string | null;
	references: string | null;
	fromAddr: string | null;
	toAddr: string | null;
	attachments: ParsedAttachment[];
};

export type ParsedAttachment = {
	filename: string | null;
	contentType: string;
	disposition: "attachment" | "inline" | null;
	contentId: string | null;
	content: ArrayBuffer;
};

function toArrayBuffer(
	content: ArrayBuffer | Uint8Array | string,
): ArrayBuffer {
	if (content instanceof ArrayBuffer) return content;
	if (typeof content === "string") return new TextEncoder().encode(content).buffer;
	return content.buffer.slice(
		content.byteOffset,
		content.byteOffset + content.byteLength,
	) as ArrayBuffer;
}

export async function parseRawMime(raw: ArrayBuffer): Promise<ParsedEmail> {
	const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
	return {
		subject: email.subject ?? null,
		text: email.text ?? null,
		html: sanitizeHtml(email.html),
		messageId: email.messageId ?? null,
		inReplyTo: email.inReplyTo ?? null,
		references: email.references ?? null,
		fromAddr: formatPostalAddress(email.from, null),
		toAddr: formatPostalAddressList(email.to, null),
		attachments: (email.attachments ?? []).map((attachment) => ({
			filename: attachment.filename ?? null,
			contentType: attachment.mimeType ?? "",
			disposition: attachment.disposition ?? null,
			contentId: attachment.contentId ?? null,
			content: toArrayBuffer(attachment.content),
		})),
	};
}

export function buildSnippet(text: string | null, html: string | null, max = 200): string {
	const source = getLatestEmailContent(text ?? htmlToReadableText(html));
	return source.replace(/\s+/g, " ").trim().slice(0, max);
}
