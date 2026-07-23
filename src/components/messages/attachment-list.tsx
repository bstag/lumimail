"use client";

import { useEffect, useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { authFetch } from "@/lib/auth/client";

type AttachmentRow = {
	id: string;
	filename: string;
	contentType: string;
	size: number;
};

type AttachmentsResponse = {
	data?: { attachments?: AttachmentRow[] };
};

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentList({ messageId }: { messageId: string }) {
	const [items, setItems] = useState<AttachmentRow[]>([]);

	useEffect(() => {
		let cancelled = false;
		authFetch(`/api/messages/${messageId}/attachments`)
			.then((res) => (res.ok ? (res.json() as Promise<AttachmentsResponse>) : null))
			.then((payload) => {
				if (cancelled || !payload?.data?.attachments) return;
				setItems(payload.data.attachments);
			})
			.catch(() => {
				/* attachments are best-effort */
			});
		return () => {
			cancelled = true;
		};
	}, [messageId]);

	if (items.length === 0) return null;

	return (
		<section className="mt-6 border-t border-border pt-4" aria-label="Attachments">
			<p className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-muted">
				<Paperclip className="h-4 w-4" />
				{items.length} attachment{items.length > 1 ? "s" : ""}
			</p>
			<ul className="flex flex-col gap-3">
				{items.map((item) => (
					<li key={item.id} className="flex flex-col gap-2">
						<AttachmentPreview item={item} />
						<a
							href={`/api/attachments/${item.id}`}
							className="flex w-fit items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-ink-muted transition-colors hover:border-border-strong hover:bg-surface-subtle"
						>
							<Download className="h-4 w-4 text-ink-faint" />
							<span className="max-w-[14rem] truncate">{item.filename}</span>
							<span className="text-xs text-ink-faint">{formatSize(item.size)}</span>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}

function AttachmentPreview({ item }: { item: AttachmentRow }) {
	const inlineSrc = `/api/attachments/${item.id}?disposition=inline`;

	if (item.contentType.startsWith("image/")) {
		return (
			// eslint-disable-next-line @next/next/no-img-element
			<img
				src={inlineSrc}
				alt={item.filename}
				className="max-h-96 max-w-full rounded-lg border border-border object-contain"
				loading="lazy"
			/>
		);
	}

	if (item.contentType === "application/pdf") {
		return (
			<iframe
				src={inlineSrc}
				title={item.filename}
				className="h-96 w-full max-w-2xl rounded-lg border border-border"
			/>
		);
	}

	return null;
}
