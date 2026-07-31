/** Pure text/HTML helpers for the compose form. */

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function plainTextToHtml(value: string): string {
	const normalized = value.replace(/\r\n?/g, "\n");
	if (!normalized) return "";
	return normalized
		.split(/\n{2,}/)
		.map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
		.join("");
}

/**
 * Strips cid: inline images before a draft autosave — the stored draft HTML
 * must not reference attachment content ids that only exist client-side.
 */
export function withoutInlineImages(value: string): string {
	return value.replace(/<img\b[^>]*\bsrc=["']cid:[^"']+["'][^>]*>/gi, "");
}

export function buildForwardQuote(
	meta: { fromAddr?: string; subject?: string | null } | undefined,
	original: string,
): string {
	return `\n\n---------- Forwarded message ----------\nFrom: ${meta?.fromAddr ?? ""}\nSubject: ${meta?.subject ?? ""}\n\n${original}`;
}
