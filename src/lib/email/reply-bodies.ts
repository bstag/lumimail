import { htmlToReadableText } from "@/lib/email/reply-content-utils";
import { sanitizeHtml } from "@/lib/email/sanitize";

export type ReplyBodySource = {
	fromAddr: string | null | undefined;
	textBody: string | null | undefined;
	htmlBody: string | null | undefined;
};

export type ReplyBodies = {
	text: string;
	html: string;
};

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n?/g, "\n");
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function textToHtml(value: string): string {
	return escapeHtml(normalizeNewlines(value)).replaceAll("\n", "<br>");
}

function quotePlainText(value: string): string {
	return normalizeNewlines(value)
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

function readableHtmlText(value: string | null): string {
	return htmlToReadableText(value)
		.replace(/[ \t]+/g, " ")
		.replace(/ *\n */g, "\n")
		.trim();
}

export function buildReplyBodies(
	authoredText: string,
	source: ReplyBodySource,
): ReplyBodies {
	const authored = normalizeNewlines(authoredText);
	const safeSourceHtml = sanitizeHtml(source.htmlBody);
	const sourceText = source.textBody
		?? readableHtmlText(safeSourceHtml);
	const attribution = `On the previous message, ${source.fromAddr ?? ""} wrote:`;
	const quoteHtml = safeSourceHtml?.trim()
		? safeSourceHtml
		: textToHtml(sourceText);

	return {
		text: `${authored}\n\n${attribution}\n${quotePlainText(sourceText)}`,
		html: `<div>${textToHtml(authored)}</div><div>${escapeHtml(attribution)}</div><blockquote>${quoteHtml}</blockquote>`,
	};
}
