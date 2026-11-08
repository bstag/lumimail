import PostalMime from "postal-mime";
import { formatPostalAddress, formatPostalAddressList } from "@/lib/email/address";
import { sanitizeHtml } from "@/lib/email/sanitize";
import { getLatestEmailContent, htmlToReadableText } from "@/lib/email/reply-content-utils";

export type ParsedEmail = {
	receivedAt?: Date | null;
	subject: string | null;
	text: string | null;
	html: string | null;
	messageId: string | null;
	inReplyTo: string | null;
	references: string | null;
	/** RFC 2369 List-Unsubscribe: first https target, first mailto target (F98). */
	unsubscribeUrl?: string | null;
	unsubscribeMailto?: string | null;
	/** RFC 8058: the https target accepts a one-click POST. */
	unsubscribeOneClick?: boolean;
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

type UnsubscribeTargets = Pick<ParsedEmail, "unsubscribeUrl" | "unsubscribeMailto" | "unsubscribeOneClick">;

function parseUnsubscribe(headers: Array<{ key: string; value: string }> | undefined): Required<UnsubscribeTargets> {
	const header = (name: string) => headers?.find((entry) => entry.key === name)?.value ?? "";
	const targets = [...header("list-unsubscribe").matchAll(/<([^>]+)>/g)].map((match) => match[1].trim());
	const unsubscribeUrl = targets.find((target) => {
		try {
			return new URL(target).protocol === "https:";
		} catch {
			return false;
		}
	}) ?? null;
	const unsubscribeMailto = targets.find((target) => /^mailto:[^@\s]+@[^@\s]+$/i.test(target.split("?")[0])) ?? null;
	return {
		unsubscribeUrl,
		unsubscribeMailto,
		unsubscribeOneClick: !!unsubscribeUrl && /list-unsubscribe=one-click/i.test(header("list-unsubscribe-post")),
	};
}

/** The `messages` unsubscribe columns for a parsed email (F98). */
export function unsubscribeColumns(parsed: UnsubscribeTargets): Required<UnsubscribeTargets> {
	return {
		unsubscribeUrl: parsed.unsubscribeUrl ?? null,
		unsubscribeMailto: parsed.unsubscribeMailto ?? null,
		unsubscribeOneClick: parsed.unsubscribeOneClick ?? false,
	};
}

export async function parseRawMime(raw: ArrayBuffer): Promise<ParsedEmail> {
	const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
	const date = email.date ? new Date(email.date) : null;
	return {
		receivedAt: date && Number.isFinite(date.getTime()) ? date : null,
		subject: email.subject ?? null,
		text: email.text ?? null,
		html: sanitizeHtml(email.html, { dropHidden: true, deferRemoteImages: true }),
		messageId: email.messageId ?? null,
		inReplyTo: email.inReplyTo ?? null,
		references: email.references ?? null,
		...parseUnsubscribe(email.headers),
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
