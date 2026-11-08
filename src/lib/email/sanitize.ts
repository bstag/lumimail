import { parseHTML } from "linkedom";
import { SAFE_EMAIL_HTML_TAGS } from "@/lib/email/html-policy";
import { sanitizeEmailStyle } from "@/lib/email/style-policy";

const allowedTags = new Set<string>(SAFE_EMAIL_HTML_TAGS);
const voidTags = new Set(["br", "hr", "img"]);
const dropSubtreeTags = new Set([
	"applet",
	"audio",
	"base",
	"button",
	"canvas",
	"embed",
	"fieldset",
	"form",
	"frame",
	"frameset",
	"head",
	"iframe",
	"input",
	"link",
	"math",
	"meta",
	"noscript",
	"object",
	"option",
	"picture",
	"plaintext",
	"portal",
	"script",
	"select",
	"source",
	"style",
	"svg",
	"template",
	"textarea",
	"title",
	"track",
	"video",
	"xmp",
]);

type TraversalEntry =
	| { kind: "node"; node: Node }
	| { kind: "close"; tag: string };

function escapeText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
	return escapeText(value).replaceAll('"', "&quot;");
}

function safeUrl(value: string | null): string | null {
	if (!value) return null;
	const candidate = value.trim();
	if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return null;

	try {
		const url = new URL(candidate);
		if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function safeSpan(value: string | null): string | null {
	if (!value || !/^\d{1,3}$/.test(value)) return null;
	const parsed = Number(value);
	return parsed >= 1 && parsed <= 100 ? String(parsed) : null;
}

function safeDimension(value: string | null): string | null {
	if (!value || !/^\d{1,4}$/.test(value)) return null;
	const parsed = Number(value);
	return parsed >= 1 && parsed <= 2000 ? String(parsed) : null;
}

function safeCid(value: string | null): string | null {
	if (!value) return null;
	const candidate = value.trim();
	return /^cid:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(candidate) ? candidate : null;
}

function safeLanguage(value: string | null): string | null {
	if (!value || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) return null;
	return value;
}

function safeDirection(value: string | null): string | null {
	if (value === "ltr" || value === "rtl" || value === "auto") return value;
	return null;
}

function remoteImageUrl(value: string | null): string | null {
	const url = safeUrl(value);
	return url && /^https?:/i.test(url) ? url : null;
}

/** A remote image kept inert for the reader to load on request (F96); 1–2 px trackers are dropped. */
function deferrableImage(element: Element, options: SanitizeOptions): boolean {
	if (!options.deferRemoteImages || !remoteImageUrl(element.getAttribute("src"))) return false;
	const tiny = (name: string) => {
		const value = Number(element.getAttribute(name));
		return Number.isFinite(value) && value > 0 && value <= 2;
	};
	return !tiny("width") && !tiny("height");
}

function pushAttribute(attributes: string[], name: string, value: string | null): void {
	if (value !== null) attributes.push(`${name}="${escapeAttribute(value)}"`);
}

function sanitizeAttributes(element: Element, tag: string, options: SanitizeOptions): string {
	const attributes: string[] = [];
	pushAttribute(attributes, "dir", safeDirection(element.getAttribute("dir")?.toLowerCase() ?? null));
	pushAttribute(attributes, "lang", safeLanguage(element.getAttribute("lang")));
	pushAttribute(
		attributes,
		"style",
		sanitizeEmailStyle(tag, element.getAttribute("style")),
	);

	if (tag === "a") {
		const href = safeUrl(element.getAttribute("href"));
		pushAttribute(attributes, "href", href);
		if (href) pushAttribute(attributes, "rel", "noopener noreferrer nofollow");
		pushAttribute(attributes, "title", element.getAttribute("title"));
	}

	if (tag === "blockquote") {
		pushAttribute(attributes, "cite", safeUrl(element.getAttribute("cite")));
	}

	if (tag === "td" || tag === "th") {
		pushAttribute(attributes, "colspan", safeSpan(element.getAttribute("colspan")));
		pushAttribute(attributes, "rowspan", safeSpan(element.getAttribute("rowspan")));
	}

	if (tag === "img") {
		const cid = safeCid(element.getAttribute("src"));
		pushAttribute(attributes, "src", cid);
		if (!cid && options.deferRemoteImages) {
			pushAttribute(attributes, "data-remote-src", remoteImageUrl(element.getAttribute("src")));
		}
		pushAttribute(attributes, "alt", element.getAttribute("alt"));
		pushAttribute(attributes, "title", element.getAttribute("title"));
		pushAttribute(attributes, "width", safeDimension(element.getAttribute("width")));
		pushAttribute(attributes, "height", safeDimension(element.getAttribute("height")));
	}

	return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
}

function pushChildren(stack: TraversalEntry[], node: Node): void {
	const children = Array.from(node.childNodes);
	for (let index = children.length - 1; index >= 0; index -= 1) {
		stack.push({ kind: "node", node: children[index] });
	}
}

const senderHidden = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i;

const documentMarkup =/^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype|html[\s>]|head[\s>])/i;

/**
 * Returns the node whose children are the readable content. Sender HTML is
 * usually a whole document, and assigning one to `body.innerHTML` makes linkedom
 * drop everything whenever whitespace follows the doctype (the common case), so
 * documents are parsed as documents. The walk starts at the document element so
 * content outside a `<body>` survives; `head` is in `dropSubtreeTags` and `body`
 * is unwrapped like any other unlisted inert element.
 */
function contentRoot(html: string): Node {
	if (documentMarkup.test(html)) return parseHTML(html).document.documentElement;
	const { document } = parseHTML("<!doctype html><html><body></body></html>");
	document.body.innerHTML = html;
	return document.body;
}

function sanitizeFragment(html: string, options: SanitizeOptions): string {
	const output: string[] = [];
	const stack: TraversalEntry[] = [];
	pushChildren(stack, contentRoot(html));

	while (stack.length > 0) {
		const entry = stack.pop();
		/* v8 ignore next -- guarded by the loop condition; defensive for future stack changes */
		if (!entry) continue;

		if (entry.kind === "close") {
			output.push(`</${entry.tag}>`);
			continue;
		}

		const { node } = entry;
		if (node.nodeType === 3) {
			/* v8 ignore next -- DOM text nodes always expose a string; fallback is defensive */
			output.push(escapeText(node.textContent ?? ""));
			continue;
		}
		if (node.nodeType !== 1) continue;

		const element = node as Element;
		const tag = element.localName.toLowerCase();
		if (dropSubtreeTags.has(tag)) continue;
		// The sender's own hiding styles are stripped below, so hidden preheaders and
		// Outlook-only blocks would otherwise become visible: drop them with their content.
		if (options.dropHidden && senderHidden.test(element.getAttribute("style") ?? "")) continue;
		if (tag === "img" && !safeCid(element.getAttribute("src")) && !deferrableImage(element, options)) continue;

		if (!allowedTags.has(tag)) {
			pushChildren(stack, node);
			continue;
		}

		output.push(`<${tag}${sanitizeAttributes(element, tag, options)}>`);
		if (voidTags.has(tag)) continue;
		stack.push({ kind: "close", tag });
		pushChildren(stack, node);
	}

	return output.join("");
}

export type SanitizeOptions = {
	/** Received mail: drop elements the sender hid (preheaders, Outlook-only blocks). */
	dropHidden?: boolean;
	/** Received mail: keep http(s) images as inert `data-remote-src` for opt-in loading (F96). */
	deferRemoteImages?: boolean;
};

export function sanitizeHtml(html: string | null | undefined, options: SanitizeOptions = {}): string | null {
	if (!html) return null;
	try {
		return sanitizeFragment(html, options);
	} catch {
		return escapeText(html);
	}
}
