/**
 * SHA-256 digest of a UTF-8 string as lowercase hex.
 *
 * Suitable only for high-entropy or non-secret inputs (session tokens,
 * rate-limit actor keys) — it is a plain unsalted digest, never a password hash.
 */
export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
