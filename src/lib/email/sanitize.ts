import { parseHTML } from "linkedom";
import { SAFE_EMAIL_HTML_TAGS } from "@/lib/email/html-policy";

const allowedTags = new Set<string>(SAFE_EMAIL_HTML_TAGS);
const voidTags = new Set(["br", "hr"]);
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
	"img",
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

function safeLanguage(value: string | null): string | null {
	if (!value || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) return null;
	return value;
}

function safeDirection(value: string | null): string | null {
	if (value === "ltr" || value === "rtl" || value === "auto") return value;
	return null;
}

function pushAttribute(attributes: string[], name: string, value: string | null): void {
	if (value !== null) attributes.push(`${name}="${escapeAttribute(value)}"`);
}

function sanitizeAttributes(element: Element, tag: string): string {
	const attributes: string[] = [];
	pushAttribute(attributes, "dir", safeDirection(element.getAttribute("dir")?.toLowerCase() ?? null));
	pushAttribute(attributes, "lang", safeLanguage(element.getAttribute("lang")));

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

	return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
}

function pushChildren(stack: TraversalEntry[], node: Node): void {
	const children = Array.from(node.childNodes);
	for (let index = children.length - 1; index >= 0; index -= 1) {
		stack.push({ kind: "node", node: children[index] });
	}
}

function sanitizeFragment(html: string): string {
	const { document } = parseHTML("<!doctype html><html><body></body></html>");
	document.body.innerHTML = html;

	const output: string[] = [];
	const stack: TraversalEntry[] = [];
	pushChildren(stack, document.body);

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

		if (!allowedTags.has(tag)) {
			pushChildren(stack, node);
			continue;
		}

		output.push(`<${tag}${sanitizeAttributes(element, tag)}>`);
		if (voidTags.has(tag)) continue;
		stack.push({ kind: "close", tag });
		pushChildren(stack, node);
	}

	return output.join("");
}

export function sanitizeHtml(html: string | null | undefined): string | null {
	if (!html) return null;
	try {
		return sanitizeFragment(html);
	} catch {
		return escapeText(html);
	}
}
