"use client";

import { Paperclip, X } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { AttachedFile } from "./use-compose-attachments";

export function AttachmentChips({
	attachments,
	onRemove,
}: {
	attachments: AttachedFile[];
	onRemove: (id: string) => void;
}) {
	if (attachments.length === 0) return null;
	return (
		<div className="border-t border-border px-4 py-2 flex flex-wrap gap-2">
			{attachments.map((attached) => (
				<div
					key={attached.id}
					className="flex items-center gap-1.5 rounded-md border border-border bg-surface-subtle px-2 py-1 text-xs text-ink-muted"
				>
					<Paperclip className="h-3 w-3 text-ink-faint flex-shrink-0" />
					<span className="max-w-[160px] truncate">{attached.file.name}</span>
					<span className="text-ink-faint">{formatBytes(attached.file.size)}</span>
					<button
						type="button"
						onClick={() => onRemove(attached.id)}
						className="ml-0.5 rounded-full p-0.5 text-ink-faint hover:bg-surface-subtle hover:text-ink-muted"
						aria-label={`Remove ${attached.file.name}`}
					>
						<X className="h-3 w-3" />
					</button>
				</div>
			))}
		</div>
	);
}
