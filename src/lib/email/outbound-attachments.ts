import { sanitizeAttachmentFilename } from "@/lib/email/attachment-storage";

export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_ENCODED_MESSAGE_BYTES = 4.5 * 1024 * 1024;

const MIME_OVERHEAD_BYTES = 2048;
const SAFE_CONTENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"application/pdf",
	"text/plain",
	"text/csv",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/zip",
]);
const DANGEROUS_EXTENSION = /\.(?:exe|bat|cmd|com|scr|vbs|js|jar|ps1|msi)$/i;

export type OutboundAttachmentInput = {
	filename: string;
	contentType: string;
	content: ArrayBuffer;
	disposition?: "attachment" | "inline";
	contentId?: string;
};

export type ValidatedOutboundAttachment = Omit<OutboundAttachmentInput, "disposition"> & {
	size: number;
	disposition: "attachment" | "inline";
};

export class AttachmentValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AttachmentValidationError";
	}
}

function encodedLength(size: number): number {
	return 4 * Math.ceil(size / 3);
}

export function validateOutboundAttachments(input: {
	subject: string;
	html?: string;
	text?: string;
	attachments?: OutboundAttachmentInput[];
}): ValidatedOutboundAttachment[] {
	const values = input.attachments ?? [];
	if (values.length > MAX_ATTACHMENT_COUNT) {
		throw new AttachmentValidationError(`Too many attachments (max ${MAX_ATTACHMENT_COUNT})`);
	}

	const normalized = values.map((attachment) => {
		const filename = sanitizeAttachmentFilename(attachment.filename);
		const contentType = attachment.contentType.toLowerCase().trim() || "application/octet-stream";
		const size = attachment.content.byteLength;
		if (size > MAX_ATTACHMENT_BYTES) {
			throw new AttachmentValidationError("Attachment too large (max 3 MiB)");
		}
		if (DANGEROUS_EXTENSION.test(filename)) {
			throw new AttachmentValidationError("Executable or script attachments are not allowed");
		}
		if (!SAFE_CONTENT_TYPES.has(contentType)) {
			throw new AttachmentValidationError(`Unsupported attachment type: ${contentType}`);
		}
		const disposition = attachment.disposition ?? "attachment";
		const contentId = attachment.contentId?.trim();
		if (disposition === "inline") {
			if (!contentType.startsWith("image/")) {
				throw new AttachmentValidationError("Inline attachments must be images");
			}
			if (!contentId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(contentId)) {
				throw new AttachmentValidationError("Inline attachment content ID is invalid");
			}
		} else if (contentId) {
			throw new AttachmentValidationError("Regular attachments cannot have a content ID");
		}
		return {
			...attachment,
			filename,
			contentType,
			size,
			disposition,
			...(contentId ? { contentId } : {}),
		};
	});

	const referencedContentIds = new Set(
		[...(input.html ?? "").matchAll(/\bsrc\s*=\s*["']cid:([A-Za-z0-9][A-Za-z0-9._-]{0,127})["']/gi)]
			.map((match) => match[1]),
	);
	const inlineContentIds = new Set(
		normalized
			.filter((attachment) => attachment.disposition === "inline")
			.map((attachment) => attachment.contentId as string),
	);
	if (
		[...referencedContentIds].some((contentId) => !inlineContentIds.has(contentId))
		|| [...inlineContentIds].some((contentId) => !referencedContentIds.has(contentId))
	) {
		throw new AttachmentValidationError("Inline image references do not match uploaded images");
	}

	const encoder = new TextEncoder();
	let estimate =
		encoder.encode(input.subject).byteLength +
		encoder.encode(input.html ?? "").byteLength +
		encoder.encode(input.text ?? "").byteLength;
	for (const attachment of normalized) {
		estimate += encodedLength(attachment.size) + MIME_OVERHEAD_BYTES;
	}
	if (estimate > MAX_ENCODED_MESSAGE_BYTES) {
		throw new AttachmentValidationError("Message and attachments are too large");
	}
	return normalized;
}

export function decodeBase64Attachment(value: string): ArrayBuffer {
	if (
		value.length % 4 !== 0 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
	) {
		throw new AttachmentValidationError("Attachment content must be valid Base64");
	}
	try {
		const decoded = atob(value);
		const bytes = new Uint8Array(decoded.length);
		for (let index = 0; index < decoded.length; index += 1) {
			bytes[index] = decoded.charCodeAt(index);
		}
		return bytes.buffer;
	} catch {
		throw new AttachmentValidationError("Attachment content must be valid Base64");
	}
}

export function encodeBase64Attachment(content: ArrayBuffer): string {
	const bytes = new Uint8Array(content);
	let binary = "";
	const chunkSize = 32_768;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}
