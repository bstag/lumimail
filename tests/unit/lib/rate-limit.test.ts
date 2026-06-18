import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitCheck, rateLimitIp, rateLimitUser } from "@/lib/rate-limit";

describe("rateLimitCheck", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows the first request and counts down remaining", () => {
		expect(rateLimitCheck("check:a", 2, 1000)).toEqual({ allowed: true, remaining: 1 });
	});

	it("increments within the window then blocks past the limit", () => {
		expect(rateLimitCheck("check:b", 2, 1000)).toEqual({ allowed: true, remaining: 1 });
		expect(rateLimitCheck("check:b", 2, 1000)).toEqual({ allowed: true, remaining: 0 });
		expect(rateLimitCheck("check:b", 2, 1000)).toEqual({ allowed: false, remaining: 0 });
	});

	it("resets after the window elapses", () => {
		expect(rateLimitCheck("check:c", 1, 1000)).toEqual({ allowed: true, remaining: 0 });
		expect(rateLimitCheck("check:c", 1, 1000)).toEqual({ allowed: false, remaining: 0 });
		vi.advanceTimersByTime(1001);
		expect(rateLimitCheck("check:c", 1, 1000)).toEqual({ allowed: true, remaining: 0 });
	});
});

describe("rateLimitIp", () => {
	it("keys on cf-connecting-ip when present", () => {
		const req = new Request("https://x.test", { headers: { "cf-connecting-ip": "1.1.1.1" } });
		expect(rateLimitIp(req, "ip-a", 1, 1000)).toEqual({ allowed: true, remaining: 0 });
		expect(rateLimitIp(req, "ip-a", 1, 1000)).toEqual({ allowed: false, remaining: 0 });
	});

	it("falls back to x-forwarded-for", () => {
		const req = new Request("https://x.test", { headers: { "x-forwarded-for": "2.2.2.2" } });
		expect(rateLimitIp(req, "ip-b", 5, 1000).allowed).toBe(true);
	});

	it("falls back to 'unknown' when no ip header is present", () => {
		const req = new Request("https://x.test");
		expect(rateLimitIp(req, "ip-c", 5, 1000).allowed).toBe(true);
	});
});

describe("rateLimitUser", () => {
	it("keys on the user id and action", () => {
		expect(rateLimitUser("usr_1", "user-a", 1, 1000)).toEqual({ allowed: true, remaining: 0 });
		expect(rateLimitUser("usr_1", "user-a", 1, 1000)).toEqual({ allowed: false, remaining: 0 });
		expect(rateLimitUser("usr_2", "user-a", 1, 1000)).toEqual({ allowed: true, remaining: 0 });
	});
});
