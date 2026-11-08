import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageBodies, messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiError } from "@/lib/api/response";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
// Raster only: SVG can carry script and external references.
const RASTER_TYPES = new Set([
	"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
	"image/x-icon", "image/vnd.microsoft.icon",
]);
// Some image hosts label real images as a generic file; those are identified by signature.
const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
	return signature.every((byte, index) => bytes[offset + index] === byte);
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The raster type a response's leading bytes identify (PNG, JPEG, GIF, WebP), or null. */
function sniffRasterType(bytes: Uint8Array): string | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
	if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
	return null;
}

/** The exact attribute text the inbound sanitizer writes for a deferred image (F96). */
function storedAttribute(url: string): string {
	const escaped = url.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
	return `data-remote-src="${escaped}"`;
}

/**
 * Loads one remote image from a received message on the reader's request. Only URLs the
 * message itself references are fetched, so this is not an open proxy; the sender sees the
 * Worker, never the reader's IP, cookies, or referrer.
 */
export const GET = withUser<{ messageId: string }>(async ({ request, env, user, params }) => {
	const url = new URL(request.url).searchParams.get("u");
	const db = getDb(env);
	const [row] = await db
		.select({ htmlBody: messageBodies.htmlBody })
		.from(messages)
		.innerJoin(messageBodies, eq(messageBodies.messageId, messages.id))
		.where(and(eq(messages.id, params.messageId), messageAccessCondition(db, user.id, user.organizationId, "read")))
		.limit(1);
	if (!row) return apiError("Message not found", 404);
	if (!url || !/^https?:\/\//i.test(url) || !row.htmlBody?.includes(storedAttribute(url))) {
		return apiError("Image not found", 404);
	}

	let upstream: Response;
	try {
		upstream = await fetch(url, {
			headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8" },
			credentials: "omit",
			referrerPolicy: "no-referrer",
			redirect: "follow",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch {
		return apiError("Image unavailable", 502);
	}
	if (!upstream.ok) return apiError("Image unavailable", 502);

	const declaredType = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
	const generic = GENERIC_TYPES.has(declaredType);
	if (!generic && !RASTER_TYPES.has(declaredType)) return apiError("Unsupported image type", 415);
	if (Number(upstream.headers.get("content-length")) > MAX_REMOTE_IMAGE_BYTES) {
		return apiError("Image too large", 413);
	}
	const bytes = await upstream.arrayBuffer();
	if (bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) return apiError("Image too large", 413);
	const contentType = generic ? sniffRasterType(new Uint8Array(bytes)) : declaredType;
	if (!contentType) return apiError("Unsupported image type", 415);

	return new Response(bytes, {
		headers: {
			"content-type": contentType,
			"content-length": String(bytes.byteLength),
			"cache-control": "private, max-age=86400",
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'; sandbox",
			"referrer-policy": "no-referrer",
		},
	});
});
