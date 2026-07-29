"use client";

import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { authFetch } from "@/lib/auth/client";
import {
	SAFE_EMAIL_HTML_ATTRIBUTES,
	SAFE_EMAIL_HTML_TAGS,
	SAFE_EMAIL_URI_PATTERN,
} from "@/lib/email/html-policy";
import { sanitizeEmailStyle } from "@/lib/email/style-policy";

type InlineAttachment = {
	id: string;
	contentId: string | null;
	disposition: "attachment" | "inline";
};

function sanitize(html: string): string {
	const purified = DOMPurify.sanitize(html, {
		ALLOWED_TAGS: [...SAFE_EMAIL_HTML_TAGS],
		ALLOWED_ATTR: [...SAFE_EMAIL_HTML_ATTRIBUTES],
		ALLOWED_URI_REGEXP: SAFE_EMAIL_URI_PATTERN,
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
	});
	const template = document.createElement("template");
	template.innerHTML = purified;
	for (const image of template.content.querySelectorAll<HTMLImageElement>("img")) {
		if (!/^cid:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/i.test(image.getAttribute("src") ?? "")) {
			image.remove();
		}
	}
	for (const element of template.content.querySelectorAll<HTMLElement>("[style]")) {
		const style = sanitizeEmailStyle(element.localName, element.getAttribute("style"));
		if (style) element.setAttribute("style", style);
		else element.removeAttribute("style");
	}
	return template.innerHTML;
}

export function resolveCidSources(html: string, attachments: InlineAttachment[]): string {
	const byContentId = new Map(
		attachments
			.filter((attachment) => attachment.disposition === "inline" && attachment.contentId)
			.map((attachment) => [attachment.contentId as string, attachment.id]),
	);
	return html.replace(
		/\bsrc=(["'])cid:([A-Za-z0-9][A-Za-z0-9._-]{0,127})\1/gi,
		(_match, quote: string, contentId: string) => {
			const id = byContentId.get(contentId);
			return id
				? `src=${quote}/api/attachments/${encodeURIComponent(id)}?disposition=inline${quote}`
				: "";
		},
	);
}

export function SafeMessageHtml({
	messageId,
	html,
	className,
}: {
	messageId: string;
	html: string;
	className?: string;
}) {
	const safeHtml = useMemo(() => sanitize(html), [html]);
	const [resolvedHtml, setResolvedHtml] = useState<string | null>(null);

	useEffect(() => {
		if (!safeHtml.includes("cid:")) return;
		let cancelled = false;
		authFetch(`/api/messages/${messageId}/attachments`)
			.then(async (response) => response.ok
				? await response.json() as { data?: { attachments?: InlineAttachment[] } }
				: null)
			.then((payload) => {
				if (!cancelled) {
					setResolvedHtml(resolveCidSources(safeHtml, payload?.data?.attachments ?? []));
				}
			})
			.catch(() => {
				if (!cancelled) setResolvedHtml(resolveCidSources(safeHtml, []));
			});
		return () => { cancelled = true; };
	}, [messageId, safeHtml]);

	const displayedHtml = safeHtml.includes("cid:") ? resolvedHtml ?? "" : safeHtml;
	return <div className={className} dangerouslySetInnerHTML={{ __html: displayedHtml }} />;
}
