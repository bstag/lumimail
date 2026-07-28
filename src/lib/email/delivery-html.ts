import { parseHTML } from "linkedom";
import { sanitizeHtml } from "@/lib/email/sanitize";

const HEADING_STYLES = {
	h1: "font-size: 2em; font-weight: 700; line-height: 1.2; margin: 0 0 0.67em;",
	h2: "font-size: 1.5em; font-weight: 700; line-height: 1.25; margin: 0 0 0.83em;",
} as const;

const DELIVERY_STYLES = {
	table: "border-collapse: collapse; width: 100%;",
	th: "border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; font-weight: 700;",
	td: "border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left;",
	blockquote: "border-left: 3px solid #cbd5e1; margin-left: 0; padding-left: 12px;",
	pre: "background-color: #f1f5f9; overflow-x: auto; padding: 12px;",
	img: "height: auto; max-width: 100%;",
} as const;

/**
 * Adds only server-owned presentation at the final delivery boundary.
 * Authored styles are removed before these constants are added.
 */
export function prepareHtmlForDelivery(
	html: string | null | undefined,
): string | undefined {
	const safeHtml = sanitizeHtml(html);
	if (!safeHtml) return undefined;

	const { document } = parseHTML("<!doctype html><html><body></body></html>");
	document.body.innerHTML = safeHtml;
	for (const [tag, style] of Object.entries(HEADING_STYLES)) {
		for (const heading of document.body.querySelectorAll(tag)) {
			heading.setAttribute("style", `${heading.getAttribute("style") ?? ""}${style}`);
		}
	}
	for (const [tag, style] of Object.entries(DELIVERY_STYLES)) {
		for (const element of document.body.querySelectorAll(tag)) {
			element.setAttribute("style", `${element.getAttribute("style") ?? ""}${style}`);
		}
	}
	return document.body.innerHTML;
}
