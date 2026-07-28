import { parseHTML } from "linkedom";
import { sanitizeHtml } from "@/lib/email/sanitize";

export type AuthoredContentInput = {
	html?: string | null;
	text?: string | null;
};

export type NormalizedAuthoredContent = {
	html: string | null;
	text: string | null;
};

const blockEndTags = new Set([
	"blockquote",
	"div",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"p",
	"pre",
	"tr",
]);

type TextTraversalEntry =
	| { kind: "node"; node: Node }
	| { kind: "end"; tag: string };

function pushChildren(stack: TextTraversalEntry[], node: Node): void {
	const children = Array.from(node.childNodes);
	for (let index = children.length - 1; index >= 0; index -= 1) {
		stack.push({ kind: "node", node: children[index] });
	}
}

export function emailHtmlToText(html: string): string {
	const { document } = parseHTML("<!doctype html><html><body></body></html>");
	document.body.innerHTML = html;
	const output: string[] = [];
	const stack: TextTraversalEntry[] = [];
	pushChildren(stack, document.body);

	while (stack.length > 0) {
		const entry = stack.pop();
		/* v8 ignore next -- guarded by the loop condition */
		if (!entry) continue;

		if (entry.kind === "end") {
			if (blockEndTags.has(entry.tag)) output.push("\n");
			if (entry.tag === "td" || entry.tag === "th") output.push("\t");
			continue;
		}

		if (entry.node.nodeType === 3) {
			/* v8 ignore next -- DOM text nodes always expose string textContent */
			output.push((entry.node.textContent ?? "").replace(/\s+/g, " "));
			continue;
		}
		if (entry.node.nodeType !== 1) continue;

		const element = entry.node as Element;
		const tag = element.localName.toLowerCase();
		if (tag === "br") {
			output.push("\n");
			continue;
		}
		if (tag === "hr") {
			output.push("\n---\n");
			continue;
		}
		if (tag === "li") output.push("- ");
		if (tag === "img") {
			const alt = element.getAttribute("alt")?.trim();
			if (alt) output.push(`[Image: ${alt}]`);
			continue;
		}
		if (tag === "td" || tag === "th") {
			stack.push({ kind: "end", tag });
			pushChildren(stack, element);
			continue;
		}
		stack.push({ kind: "end", tag });
		pushChildren(stack, element);
	}

	return output
		.join("")
		.replaceAll("\u00a0", " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function normalizePlainText(text: string | null | undefined): string | null {
	const normalized = (text ?? "").replace(/\r\n?/g, "\n").trim();
	return normalized || null;
}

export function normalizeAuthoredContent(
	input: AuthoredContentInput,
	options: { allowInlineImages?: boolean } = {},
): NormalizedAuthoredContent {
	const sanitizedHtml = stripInlineImages(
		sanitizeHtml(input.html),
		options.allowInlineImages ?? false,
	);
	if (sanitizedHtml) {
		const derivedText = emailHtmlToText(sanitizedHtml);
		if (derivedText) return { html: sanitizedHtml, text: derivedText };
	}

	return {
		html: null,
		text: normalizePlainText(input.text),
	};
}

export function stripInlineImages(
	html: string | null,
	allowInlineImages = false,
): string | null {
	if (!html || allowInlineImages) return html;
	return html.replace(/<img\b[^>]*\bsrc="cid:[^"]+"[^>]*>/gi, "");
}
