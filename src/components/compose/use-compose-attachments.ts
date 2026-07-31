import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

export type AttachedFile = {
	file: File;
	id: string;
	disposition: "attachment" | "inline";
	contentId?: string;
};

const MAX_SIZE = 3 * 1024 * 1024;
const MAX_COUNT = 10;
const INLINE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/**
 * Owns the compose form's attachment state: regular file attachments, inline
 * cid: images inserted into the editor, and removal (which also strips the
 * matching <img> from the editor HTML). Limits mirror the server contract
 * (10 files, 3 MiB each); violations surface through `onError`.
 */
export function useComposeAttachments(editor: Editor | null, onError: (message: string) => void) {
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const imageInputRef = useRef<HTMLInputElement>(null);

	function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
		const files = Array.from(event.target.files ?? []);
		const oversized = files.filter((f) => f.size > MAX_SIZE);

		if (oversized.length > 0) {
			onError(`File(s) exceed 3 MiB: ${oversized.map((f) => f.name).join(", ")}`);
		}

		const valid = files.filter((f) => f.size <= MAX_SIZE);
		setAttachedFiles((prev) => {
			const available = Math.max(0, MAX_COUNT - prev.length);
			if (valid.length > available) {
				onError(`You can attach up to ${MAX_COUNT} files.`);
			}
			return [
				...prev,
				...valid.slice(0, available).map((file) => ({
					file,
					id: `${file.name}-${file.size}-${Date.now()}-${crypto.randomUUID()}`,
					disposition: "attachment" as const,
				})),
			];
		});

		// Reset input so the same file can be re-added if removed
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	function handleInlineImageChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (imageInputRef.current) imageInputRef.current.value = "";
		if (!file || !editor) return;
		if (!INLINE_IMAGE_TYPES.includes(file.type)) {
			onError("Inline images must be JPEG, PNG, GIF, or WebP.");
			return;
		}
		if (file.size > MAX_SIZE || attachedFiles.length >= MAX_COUNT) {
			onError("Inline image exceeds the attachment limits.");
			return;
		}
		const contentId = `img_${crypto.randomUUID().replaceAll("-", "")}`;
		setAttachedFiles((current) => [
			...current,
			{ file, id: contentId, disposition: "inline", contentId },
		]);
		editor.chain().focus().setImage({ src: `cid:${contentId}`, alt: file.name }).run();
	}

	function removeAttachment(id: string) {
		setAttachedFiles((prev) => {
			const removed = prev.find((attachment) => attachment.id === id);
			if (removed?.contentId && editor) {
				const escaped = removed.contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				editor.commands.setContent(
					editor.getHTML().replace(
						new RegExp(`<img\\b[^>]*\\bsrc=["']cid:${escaped}["'][^>]*>`, "gi"),
						"",
					),
				);
			}
			return prev.filter((attachment) => attachment.id !== id);
		});
	}

	function removeByContentId(contentId: string) {
		setAttachedFiles((current) =>
			current.filter((attachment) => attachment.contentId !== contentId),
		);
	}

	function clearAttachments() {
		setAttachedFiles([]);
	}

	return {
		attachedFiles,
		fileInputRef,
		imageInputRef,
		handleFileInputChange,
		handleInlineImageChange,
		removeAttachment,
		removeByContentId,
		clearAttachments,
	};
}
