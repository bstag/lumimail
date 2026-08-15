import { describe, expect, it, vi } from "vitest";

import {
	PERFORMANCE_CHECKS,
	measureProductionPerformance,
	runPerformanceEvidenceCommand,
} from "../../../scripts/performance-evidence.mjs";

const origin = "https://mail.example.com";
const token = "owner-session-token";

function response(status = 200, body: unknown = { private: "must-not-escape" }, contentType = "application/json") {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": contentType },
	});
}

function timedClock(durations: number[]) {
	let call = 0;
	let elapsed = 0;
	return () => {
		if (call % 2 === 0) {
			call += 1;
			return elapsed;
		}
		const duration = durations[Math.floor(call / 2)] ?? 1;
		elapsed += duration;
		call += 1;
		return elapsed;
	};
}

describe("measureProductionPerformance", () => {
	it("measures only the fixed allowlist serially and returns content-free summaries", async () => {
		let active = 0;
		let maxActive = 0;
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			calls.push({ url: String(url), init });
			await Promise.resolve();
			active -= 1;
			return response();
		});
		const requestCount = PERFORMANCE_CHECKS.length * 16;
		const report = await measureProductionPerformance({
			origin,
			sessionToken: token,
			fetchImpl,
			clock: timedClock(Array(requestCount).fill(25)),
			now: () => new Date("2026-08-13T23:00:00.000Z"),
		});

		expect(maxActive).toBe(1);
		expect(calls).toHaveLength(requestCount);
		expect(calls.map((call) => new URL(call.url).pathname)).toEqual(
			PERFORMANCE_CHECKS.flatMap((check) => Array(16).fill(check.path)),
		);
		for (const call of calls) {
			expect(call.init).toEqual(expect.objectContaining({
				method: "GET",
				redirect: "error",
				headers: { accept: "application/json", authorization: `Bearer ${token}` },
			}));
			expect(call.init?.signal).toBeInstanceOf(AbortSignal);
		}
		expect(report!).toEqual(expect.objectContaining({
			format: "lumimail-production-performance-v1",
			host: "mail.example.com",
			observedAt: "2026-08-13T23:00:00.000Z",
			outcome: "passed",
			sampleCount: 15,
		}));
		expect(report!.checks).toHaveLength(PERFORMANCE_CHECKS.length);
		expect(report!.checks[0]).toEqual(expect.objectContaining({
			name: PERFORMANCE_CHECKS[0].name,
			status: 200,
			p50Ms: 25,
			p95Ms: 25,
			maxMs: 25,
			outcome: "passed",
		}));
		const serialized = JSON.stringify(report!);
		expect(serialized).not.toContain(token);
		expect(serialized).not.toContain("must-not-escape");
	});

	it("passes exactly at a target and fails when one measured sample exceeds it", async () => {
		const requestCount = PERFORMANCE_CHECKS.length * 16;
		const durations = Array(requestCount).fill(1);
		const firstTarget = PERFORMANCE_CHECKS[0].targetP95Ms;
		for (let index = 1; index < 16; index += 1) durations[index] = firstTarget;
		const boundary = await measureProductionPerformance({ origin, sessionToken: token,
			fetchImpl: vi.fn().mockImplementation(() => response()), clock: timedClock(durations) });
		expect(boundary!.checks[0].p95Ms).toBe(firstTarget);
		expect(boundary!.outcome).toBe("passed");

		durations[15] = firstTarget + 1;
		const failed = await measureProductionPerformance({ origin, sessionToken: token,
			fetchImpl: vi.fn().mockImplementation(() => response()), clock: timedClock(durations) });
		expect(failed!.checks[0]).toEqual(expect.objectContaining({ p95Ms: firstTarget + 1, outcome: "failed" }));
		expect(failed!.outcome).toBe("failed");
	});

	it.each([
		["http://mail.example.com", token],
		["https://mail.example.com/path", token],
		["https://user@mail.example.com", token],
		[origin, ""],
		[origin, "has whitespace"],
	])("refuses an invalid origin/token before network access", async (candidateOrigin, candidateToken) => {
		const fetchImpl = vi.fn();
		await expect(measureProductionPerformance({ origin: candidateOrigin, sessionToken: candidateToken, fetchImpl }))
			.rejects.toThrow("Production performance evidence could not be measured");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		["wrong status", () => response(403)],
		["wrong content type", () => response(200, {}, "text/plain")],
		["invalid JSON", () => new Response("not-json", { status: 200,
			headers: { "content-type": "application/json" } })],
		["network failure", () => Promise.reject(new Error("PRIVATE network detail"))],
	])("fails safely on %s without exposing private details", async (_name, result) => {
		const fetchImpl = vi.fn().mockImplementation(result);
		await expect(measureProductionPerformance({ origin, sessionToken: token, fetchImpl }))
			.rejects.toThrow("Production performance evidence could not be measured");
		try {
			await measureProductionPerformance({ origin, sessionToken: token, fetchImpl });
		} catch (error) {
			expect(String(error)).not.toMatch(/PRIVATE|must-not-escape|owner-session-token/);
		}
	});

	it("rejects an invalid observation clock", async () => {
		await expect(measureProductionPerformance({ origin, sessionToken: token,
			fetchImpl: vi.fn().mockResolvedValue(response()), now: () => new Date(Number.NaN) }))
			.rejects.toThrow("Production performance evidence could not be measured");
	});
});

describe("runPerformanceEvidenceCommand", () => {
	it("prints fixed summaries and returns the aggregate outcome", async () => {
		const stdout = vi.fn();
		const report = {
			format: "lumimail-production-performance-v1",
			host: "mail.example.com",
			observedAt: "2026-08-13T23:00:00.000Z",
			outcome: "passed" as const,
			sampleCount: 15,
			checks: PERFORMANCE_CHECKS.map((check) => ({ ...check, status: 200, p50Ms: 10,
				p95Ms: 20, maxMs: 30, outcome: "passed" as const })),
		};
		const exitCode = await runPerformanceEvidenceCommand([origin], { stdout, stderr: vi.fn(),
			environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: token }, measure: vi.fn().mockResolvedValue(report) });
		expect(exitCode).toBe(0);
		expect(stdout).toHaveBeenCalledTimes(PERFORMANCE_CHECKS.length + 1);
		expect(stdout.mock.calls.at(-1)?.[0]).toBe("PASS  6/6 production latency targets");
	});

	it("returns one with bounded output for failed targets or invalid invocation", async () => {
		const stderr = vi.fn();
		expect(await runPerformanceEvidenceCommand([], { stderr, stdout: vi.fn() })).toBe(1);
		expect(await runPerformanceEvidenceCommand([origin, "extra"], { stderr, stdout: vi.fn() })).toBe(1);
		expect(stderr).toHaveBeenCalledWith("Usage: node scripts/performance-evidence.mjs <https-origin>   (set LUMIMAIL_SESSION_TOKEN)");

		const failedReport = {
			outcome: "failed" as const,
			checks: PERFORMANCE_CHECKS.map((check, index) => ({ ...check, status: 200, p50Ms: 10,
				p95Ms: index ? 20 : check.targetP95Ms + 1, maxMs: 30,
				outcome: index ? "passed" as const : "failed" as const })),
		};
		expect(await runPerformanceEvidenceCommand([origin], { stderr, stdout: vi.fn(),
			environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: token }, measure: vi.fn().mockResolvedValue(failedReport) })).toBe(1);
	});

	it("bounds measurement failures", async () => {
		const stderr = vi.fn();
		expect(await runPerformanceEvidenceCommand([origin], { stderr, stdout: vi.fn(),
			environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: token },
			measure: vi.fn().mockRejectedValue(new Error("PRIVATE")) })).toBe(1);
		expect(stderr).toHaveBeenLastCalledWith("Production performance evidence could not be measured.");
	});
});
