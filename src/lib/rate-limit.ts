import { sha256Hex } from "@/lib/crypto-utils";

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
}

export class RateLimitUnavailableError extends Error {
	constructor(cause?: unknown) {
		// The cause keeps the underlying D1 failure (or the deliberate
		// "Missing rate-limit result" error) diagnosable without leaking it into
		// the message shown to callers.
		super("Rate limit storage unavailable", { cause });
		this.name = "RateLimitUnavailableError";
	}
}

export async function rateLimitCheck(
	env: CloudflareEnv,
	key: string,
	maxRequests: number,
	windowMs: number,
	now = Date.now(),
): Promise<RateLimitResult> {
	try {
		const keyHash = await sha256Hex(key);
		// The upsert never depends on expired rows being purged: an expired row is
		// reset in place by the CASE expressions. purgeExpiredRateLimits (cron) only
		// bounds table growth from one-time actors.
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
	} catch (error) {
		throw new RateLimitUnavailableError(error);
	}
}

/**
 * Removes counters whose window has ended. Runs from the scheduled cron in
 * worker.ts rather than on every check: the check's upsert already ignores
 * expired rows, so this exists only to stop the table growing without bound.
 * Best-effort by design — a failed purge must not abort the rest of the cron.
 */
export async function purgeExpiredRateLimits(env: CloudflareEnv, now = Date.now()): Promise<void> {
	try {
		await env.DB.prepare("DELETE FROM rate_limits WHERE reset_at <= ?")
			.bind(now)
			.run();
	} catch (error) {
		console.warn("Rate-limit purge failed", error);
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

export type EnforceRateLimitOptions<R extends Response = Response> = {
	/** Logged (message only, no cause) when the shared store is unavailable. */
	unavailableLog: string;
	/** Message for the 429 produced when the counter is exhausted. */
	limitedMessage: string;
	/**
	 * Builds the error response body. Routes pass their own shape here so the
	 * limiter never dictates it (auth/login uses a bare `{ error }` body while
	 * envelope routes pass `apiError`).
	 */
	respond: (message: string, status: 429 | 503) => R;
};

/**
 * Awaits a rate-limit check and turns its two failure modes into the route's
 * error responses: storage unavailable fails closed as a 503 and an exhausted
 * counter becomes a 429. Returns `null` when the request may proceed.
 * Unexpected (non-limiter) errors are rethrown untouched.
 */
export async function enforceRateLimit<R extends Response>(
	check: Promise<RateLimitResult>,
	options: EnforceRateLimitOptions<R>,
): Promise<R | null> {
	let result: RateLimitResult;
	try {
		result = await check;
	} catch (error) {
		if (error instanceof RateLimitUnavailableError) {
			console.error(options.unavailableLog);
			return options.respond("Service temporarily unavailable", 503);
		}
		throw error;
	}
	if (!result.allowed) return options.respond(options.limitedMessage, 429);
	return null;
}
