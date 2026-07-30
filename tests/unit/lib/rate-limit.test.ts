import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	RateLimitUnavailableError,
	enforceRateLimit,
	purgeExpiredRateLimits,
	rateLimitCheck,
	rateLimitIp,
	rateLimitUser,
} from "@/lib/rate-limit";
import { sha256Hex } from "@/lib/crypto-utils";

function envWithCounts(counts: number[]) {
	const bind = vi.fn<(...args: unknown[]) => {
		first: ReturnType<typeof vi.fn>;
		run: ReturnType<typeof vi.fn>;
	}>(() => ({
		first: vi.fn(async () => ({ count: counts.shift() ?? 1 })),
		run: vi.fn(async () => ({ success: true })),
	}));
	const prepare = vi.fn(() => ({ bind }));
	return {
		env: { DB: { prepare } } as unknown as CloudflareEnv,
		prepare,
		bind,
	};
}

/**
 * Real-SQL harness: the fixed-window upsert's correctness (expired rows reset
 * in place, no reliance on the purge) can only be proven by executing the
 * actual statement, not by a canned mock.
 */
function envWithSqlite() {
	const database = new DatabaseSync(":memory:");
	database.exec(
		"CREATE TABLE rate_limits (key_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)",
	);
	const env = {
		DB: {
			prepare: (sql: string) => {
				const statement = database.prepare(sql);
				return {
					bind: (...args: (string | number)[]) => ({
						first: async () => statement.get(...args) ?? null,
						run: async () => {
							statement.run(...args);
							return { success: true };
						},
					}),
				};
			},
		},
	} as unknown as CloudflareEnv;
	return { env, database };
}

afterEach(() => vi.restoreAllMocks());

describe("durable rate limits", () => {
	it("uses the D1 counter result to allow and block requests", async () => {
		const { env } = envWithCounts([1, 2, 3]);
		expect(await rateLimitCheck(env, "login::ip::1", 2, 1000, 100)).toEqual({
			allowed: true,
			remaining: 1,
		});
		expect(await rateLimitCheck(env, "login::ip::1", 2, 1000, 100)).toEqual({
			allowed: true,
			remaining: 0,
		});
		expect(await rateLimitCheck(env, "login::ip::1", 2, 1000, 100)).toEqual({
			allowed: false,
			remaining: 0,
		});
	});

	it("stores a digest instead of a raw identity", async () => {
		const { env, bind } = envWithCounts([1]);
		await rateLimitCheck(env, "login::ip::203.0.113.4", 5, 1000, 100);
		const [key] = bind.mock.calls[0] as unknown as [string];
		expect(key).toMatch(/^[a-f0-9]{64}$/);
		expect(key).not.toContain("203.0.113.4");
	});

	it("issues no purge on the check path", async () => {
		const { env, prepare } = envWithCounts([1]);
		await rateLimitCheck(env, "login::ip::1", 5, 1000, 100);
		expect(prepare).toHaveBeenCalledTimes(1);
		const [sql] = prepare.mock.calls[0] as unknown as [string];
		expect(sql).not.toContain("DELETE");
	});

	it("trusts only Cloudflare's connecting-IP header", async () => {
		const { env, bind } = envWithCounts([1, 1]);
		await rateLimitIp(env, new Request("https://x", {
			headers: { "x-forwarded-for": "203.0.113.5" },
		}), "login", 5, 1000);
		const firstDigest = bind.mock.calls[0]?.[0];
		await rateLimitIp(env, new Request("https://x"), "login", 5, 1000);
		expect(bind.mock.calls[1]?.[0]).toBe(firstDigest);
	});

	it("separates user identities", async () => {
		const { env, bind } = envWithCounts([1, 1]);
		await rateLimitUser(env, "usr_1", "send", 50, 1000);
		await rateLimitUser(env, "usr_2", "send", 50, 1000);
		expect(bind.mock.calls[0]?.[0]).not.toBe(bind.mock.calls[1]?.[0]);
	});

	it("fails closed when D1 is unavailable, keeping the cause", async () => {
		const failure = new Error("down");
		const env = {
			DB: { prepare: vi.fn(() => { throw failure; }) },
		} as unknown as CloudflareEnv;
		const rejection = await rateLimitCheck(env, "x", 1, 1000).catch((error) => error);
		expect(rejection).toBeInstanceOf(RateLimitUnavailableError);
		expect((rejection as RateLimitUnavailableError).cause).toBe(failure);
	});

	it("fails closed when D1 returns no counter row, distinguishably", async () => {
		const bind = vi.fn(() => ({
			run: vi.fn(async () => ({ success: true })),
			first: vi.fn(async () => null),
		}));
		const env = {
			DB: { prepare: vi.fn(() => ({ bind })) },
		} as unknown as CloudflareEnv;
		const rejection = await rateLimitCheck(env, "x", 1, 1000).catch((error) => error);
		expect(rejection).toBeInstanceOf(RateLimitUnavailableError);
		expect(((rejection as RateLimitUnavailableError).cause as Error).message).toBe(
			"Missing rate-limit result",
		);
	});

	it("resets an expired row in place without depending on any purge", async () => {
		const { env, database } = envWithSqlite();
		const keyHash = await sha256Hex("login::ip::1");
		// An exhausted counter whose window ended before `now`, never purged.
		database
			.prepare("INSERT INTO rate_limits (key_hash, count, reset_at) VALUES (?, ?, ?)")
			.run(keyHash, 99, 1000);

		expect(await rateLimitCheck(env, "login::ip::1", 2, 500, 1000)).toEqual({
			allowed: true,
			remaining: 1,
		});
		expect(database.prepare("SELECT count, reset_at FROM rate_limits WHERE key_hash = ?").get(keyHash))
			.toMatchObject({ count: 1, reset_at: 1500 });

		// A second request inside the fresh window increments rather than resets.
		expect(await rateLimitCheck(env, "login::ip::1", 2, 500, 1001)).toEqual({
			allowed: true,
			remaining: 0,
		});
	});
});

describe("enforceRateLimit", () => {
	const respond = vi.fn(
		(message: string, status: 429 | 503) =>
			new Response(JSON.stringify({ error: message }), { status }),
	);
	const options = {
		unavailableLog: "Test rate limit unavailable",
		limitedMessage: "Too many attempts",
		respond,
	};

	it("returns null and builds no response when the request is allowed", async () => {
		respond.mockClear();
		const result = await enforceRateLimit(
			Promise.resolve({ allowed: true, remaining: 1 }),
			options,
		);
		expect(result).toBeNull();
		expect(respond).not.toHaveBeenCalled();
	});

	it("answers 429 with the route's message when the counter is exhausted", async () => {
		respond.mockClear();
		const result = await enforceRateLimit(
			Promise.resolve({ allowed: false, remaining: 0 }),
			options,
		);
		expect(result?.status).toBe(429);
		expect(respond).toHaveBeenCalledWith("Too many attempts", 429);
	});

	it("fails closed as 503 and logs when the store is unavailable", async () => {
		respond.mockClear();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const result = await enforceRateLimit(
			Promise.reject(new RateLimitUnavailableError(new Error("down"))),
			options,
		);
		expect(result?.status).toBe(503);
		expect(respond).toHaveBeenCalledWith("Service temporarily unavailable", 503);
		expect(errorSpy).toHaveBeenCalledWith("Test rate limit unavailable");
	});

	it("rethrows unexpected (non-limiter) errors untouched", async () => {
		respond.mockClear();
		const failure = new Error("unexpected");
		await expect(enforceRateLimit(Promise.reject(failure), options)).rejects.toBe(failure);
		expect(respond).not.toHaveBeenCalled();
	});
});

describe("purgeExpiredRateLimits", () => {
	it("deletes only rows whose window has ended", async () => {
		const { env, database } = envWithSqlite();
		const insert = database.prepare(
			"INSERT INTO rate_limits (key_hash, count, reset_at) VALUES (?, ?, ?)",
		);
		insert.run("expired", 3, 999);
		insert.run("boundary", 3, 1000);
		insert.run("live", 3, 1001);

		await purgeExpiredRateLimits(env, 1000);

		const remaining = database
			.prepare("SELECT key_hash FROM rate_limits ORDER BY key_hash")
			.all() as { key_hash: string }[];
		expect(remaining.map((row) => row.key_hash)).toEqual(["live"]);
	});

	it("logs and resolves when the purge fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const failure = new Error("down");
		const env = {
			DB: { prepare: vi.fn(() => { throw failure; }) },
		} as unknown as CloudflareEnv;

		await expect(purgeExpiredRateLimits(env)).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledWith("Rate-limit purge failed", failure);
	});
});
