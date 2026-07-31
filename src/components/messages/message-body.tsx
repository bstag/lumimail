"use client";

import { SafeMessageHtml } from "./safe-message-html";

type QuotedContent = { dateLine: string; content: string };

export type MessageBodyContent = {
	latestContent: string;
	quotedContent: QuotedContent[];
	htmlBody: string | null;
};

/**
 * Renders a message body: sanitized HTML when present, otherwise the plain
 * text with earlier replies split into quoted blocks. Shared by the single
 * message view and the thread items on the detail page (T-36).
 *
 * The `variant` keeps each caller's original spacing so the extraction is
 * render-identical.
 */
export function MessageBody({
	messageId,
	body,
	variant = "single",
}: {
	messageId: string;
	body: MessageBodyContent;
	variant?: "single" | "thread";
}) {
	const blockSpacing = variant === "thread" ? "mt-4" : "mt-6";
	const dateLineSpacing = variant === "thread" ? "mb-2" : "mb-3";

	return (
		<>
			{body.htmlBody ? (
				<SafeMessageHtml messageId={messageId} html={body.htmlBody} />
			) : (
				<pre className="whitespace-pre-wrap text-sm">{body.latestContent}</pre>
			)}
			{body.quotedContent.map((quotedContent) => (
				<blockquote
					key={`${quotedContent.dateLine}-${quotedContent.content.slice(0, 24)}`}
					className={`${blockSpacing} border-l-2 border-border-strong pl-4 text-ink-muted`}
				>
					<p className={`${dateLineSpacing} text-xs font-medium text-ink-faint`}>
						{quotedContent.dateLine}
					</p>
					<pre className="whitespace-pre-wrap text-sm font-sans">
						{quotedContent.content}
					</pre>
				</blockquote>
			))}
		</>
	);
}
