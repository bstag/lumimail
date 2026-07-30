export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
}

export class RateLimitUnavailableError extends Error {
	constructor() {
		super("Rate limit storage unavailable");
		this.name = "RateLimitUnavailableError";
	}
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashKey(key: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
	return bytesToHex(new Uint8Array(digest));
}

export async function rateLimitCheck(
	env: CloudflareEnv,
	key: string,
	maxRequests: number,
	windowMs: number,
	now = Date.now(),
): Promise<RateLimitResult> {
	try {
		const keyHash = await hashKey(key);
		await env.DB.prepare("DELETE FROM rate_limits WHERE reset_at <= ?")
			.bind(now)
			.run();
		const row = await env.DB.prepare(`
			INSERT INTO rate_limits (key_hash, count, reset_at)
			VALUES (?, 1, ?)
			ON CONFLICT(key_hash) DO UPDATE SET
				count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
				reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
			RETURNING count
		`)
			.bind(keyHash, now + windowMs, now, now)
			.first<{ count: number }>();
		if (!row) throw new Error("Missing rate-limit result");
		return {
			allowed: row.count <= maxRequests,
			remaining: Math.max(0, maxRequests - row.count),
		};
	} catch {
		throw new RateLimitUnavailableError();
	}
}

export function rateLimitIp(
	env: CloudflareEnv,
	request: Request,
	action: string,
	maxRequests: number,
	windowMs: number,
) {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	return rateLimitCheck(env, `${action}::ip::${ip}`, maxRequests, windowMs);
}

export function rateLimitUser(
	env: CloudflareEnv,
	userId: string,
	action: string,
	maxRequests: number,
	windowMs: number,
) {
	return rateLimitCheck(env, `${action}::user::${userId}`, maxRequests, windowMs);
}
