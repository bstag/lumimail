import { describe, expect, it, vi } from "vitest";
import {
	RateLimitUnavailableError,
	rateLimitCheck,
	rateLimitIp,
	rateLimitUser,
} from "@/lib/rate-limit";

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
		const [key] = bind.mock.calls[1] as unknown as [string];
		expect(key).toMatch(/^[a-f0-9]{64}$/);
		expect(key).not.toContain("203.0.113.4");
	});

	it("trusts only Cloudflare's connecting-IP header", async () => {
		const { env, bind } = envWithCounts([1, 1]);
		await rateLimitIp(env, new Request("https://x", {
			headers: { "x-forwarded-for": "203.0.113.5" },
		}), "login", 5, 1000);
		const firstDigest = bind.mock.calls[1]?.[0];
		await rateLimitIp(env, new Request("https://x"), "login", 5, 1000);
		expect(bind.mock.calls[3]?.[0]).toBe(firstDigest);
	});

	it("separates user identities", async () => {
		const { env, bind } = envWithCounts([1, 1]);
		await rateLimitUser(env, "usr_1", "send", 50, 1000);
		await rateLimitUser(env, "usr_2", "send", 50, 1000);
		expect(bind.mock.calls[1]?.[0]).not.toBe(bind.mock.calls[3]?.[0]);
	});

	it("fails closed when D1 is unavailable", async () => {
		const env = {
			DB: { prepare: vi.fn(() => { throw new Error("down"); }) },
		} as unknown as CloudflareEnv;
		await expect(rateLimitCheck(env, "x", 1, 1000)).rejects.toBeInstanceOf(
			RateLimitUnavailableError,
		);
	});

	it("fails closed when D1 returns no counter row", async () => {
		const bind = vi.fn(() => ({
			run: vi.fn(async () => ({ success: true })),
			first: vi.fn(async () => null),
		}));
		const env = {
			DB: { prepare: vi.fn(() => ({ bind })) },
		} as unknown as CloudflareEnv;
		await expect(rateLimitCheck(env, "x", 1, 1000)).rejects.toBeInstanceOf(
			RateLimitUnavailableError,
		);
	});
});
