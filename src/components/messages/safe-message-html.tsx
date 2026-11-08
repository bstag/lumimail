"use client";

import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";
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

export function sanitizeMessageHtml(html: string): string {
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
		const src = image.getAttribute("src");
		const cid = src !== null && /^cid:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/i.test(src);
		const deferred = src === null && REMOTE_IMAGE.test(image.getAttribute("data-remote-src") ?? "");
		if (cid) image.removeAttribute("data-remote-src");
		else if (!deferred) image.remove();
	}
	for (const element of template.content.querySelectorAll<HTMLElement>("[style]")) {
		const style = sanitizeEmailStyle(element.localName, element.getAttribute("style"));
		if (style) element.setAttribute("style", style);
		else element.removeAttribute("style");
	}
	return template.innerHTML;
}

const REMOTE_IMAGE = /^https?:\/\//i;

/** Remote images withheld until the reader opts in (F96). */
export function countRemoteImages(html: string): number {
	const template = document.createElement("template");
	template.innerHTML = html;
	return template.content.querySelectorAll("img[data-remote-src]").length;
}

/** Points each withheld image at the message-scoped proxy, which never exposes the reader. */
export function loadRemoteImages(html: string, messageId: string): string {
	const template = document.createElement("template");
	template.innerHTML = html;
	for (const image of template.content.querySelectorAll<HTMLImageElement>("img[data-remote-src]")) {
		const url = image.getAttribute("data-remote-src") ?? "";
		image.removeAttribute("data-remote-src");
		image.setAttribute(
			"src",
			`/api/messages/${encodeURIComponent(messageId)}/remote-image?u=${encodeURIComponent(url)}`,
		);
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
	const t = useTranslations("messages");
	const [showImages, setShowImages] = useState(false);
	const sanitizedHtml = useMemo(() => sanitizeMessageHtml(html), [html]);
	const hiddenImages = useMemo(() => countRemoteImages(sanitizedHtml), [sanitizedHtml]);
	const safeHtml = useMemo(
		() => (showImages ? loadRemoteImages(sanitizedHtml, messageId) : sanitizedHtml),
		[showImages, sanitizedHtml, messageId],
	);
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
	return <>
		{hiddenImages > 0 && !showImages && (
			<div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs text-ink-muted">
				<ImageOff className="h-4 w-4 shrink-0" aria-hidden />
				<span>{t("remoteImagesHidden", { count: hiddenImages })}</span>
				<button type="button" onClick={() => setShowImages(true)} className="font-medium text-accent underline-offset-2 hover:underline">
					{t("showImages")}
				</button>
			</div>
		)}
		<div className={className} dangerouslySetInnerHTML={{ __html: displayedHtml }} />
	</>;
}
