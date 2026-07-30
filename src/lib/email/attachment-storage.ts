/**
 * The R2 key scheme for stored attachment bytes is a security invariant: the
 * outbound consumer re-verifies that a queued snapshot's key sits under the
 * owning user and message before loading bytes (see loadOutboundAttachments in
 * send.ts). Every writer and verifier must derive keys from this one function so
 * the scheme cannot drift apart silently.
 */
export function attachmentKey(userId: string, messageId: string, attachmentId: string): string {
	return `attachments/${userId}/${messageId}/${attachmentId}`;
}

/**
 * Best-effort bulk removal of attachment objects after a failed write path.
 * Failures are logged, never thrown: the caller is already propagating the
 * original error, and an orphaned object is reclaimed by the R2 retention sweep.
 */
export async function cleanupAttachmentObjects(env: CloudflareEnv, keys: string[]): Promise<void> {
	if (keys.length === 0) return;
	try {
		await env.BUCKET.delete(keys.length === 1 ? keys[0] : keys);
	} catch {
		console.error("Failed to clean up attachment objects");
	}
}

/**
 * Strips any path component and control characters, caps the result at 255
 * characters, and falls back to "attachment" for names that sanitize to nothing.
 */
export function sanitizeAttachmentFilename(value: string | null): string {
	const pieces = (value ?? "").replaceAll("\\", "/").split("/");
	const leaf = pieces[pieces.length - 1];
	const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
	return (cleaned || "attachment").slice(0, 255);
}
