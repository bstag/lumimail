import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const FORMAT = "lumimail-production-performance-v1";
const SAMPLE_COUNT = 15;
const TIMEOUT_MS = 15_000;
const FAILURE_MESSAGE = "Production performance evidence could not be measured.";
const USAGE = "Usage: node scripts/performance-evidence.mjs <https-origin>   (set LUMIMAIL_SESSION_TOKEN)";

export const PERFORMANCE_CHECKS = Object.freeze([
	Object.freeze({ name: "session", path: "/api/auth/me", targetP95Ms: 1_000 }),
	Object.freeze({ name: "mailboxes", path: "/api/mailboxes", targetP95Ms: 1_000 }),
	Object.freeze({ name: "domains", path: "/api/domains", targetP95Ms: 1_500 }),
	Object.freeze({ name: "routing", path: "/api/routing-rules", targetP95Ms: 1_500 }),
	Object.freeze({ name: "queue-health", path: "/api/admin/queue-health", targetP95Ms: 1_500 }),
	Object.freeze({ name: "r2-retention", path: "/api/admin/r2-retention", targetP95Ms: 3_000 }),
]);

class SafePerformanceEvidenceError extends Error {
	constructor() {
		super(FAILURE_MESSAGE);
		this.name = "SafePerformanceEvidenceError";
	}
}

function fail() {
	throw new SafePerformanceEvidenceError();
}

function exactOrigin(value) {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.origin !== value || url.pathname !== "/" ||
			url.username || url.password || url.search || url.hash) fail();
		return url;
	} catch (error) {
		if (error instanceof SafePerformanceEvidenceError) throw error;
		fail();
	}
}

function safeToken(value) {
	if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /\s/.test(value)) fail();
	return value;
}

function rounded(value) {
	return Math.round(value * 100) / 100;
}

function percentile(sorted, fraction) {
	return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function timedRead({ url, sessionToken, fetchImpl, clock }) {
	const started = clock();
	if (!Number.isFinite(started)) fail();
	let response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			redirect: "error",
			headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase()
			.startsWith("application/json")) fail();
		await response.json();
	} catch (error) {
		if (error instanceof SafePerformanceEvidenceError) throw error;
		fail();
	}
	const finished = clock();
	const duration = finished - started;
	if (!Number.isFinite(finished) || !Number.isFinite(duration) || duration < 0) fail();
	return rounded(duration);
}

export async function measureProductionPerformance({
	origin,
	sessionToken,
	fetchImpl = fetch,
	clock = () => performance.now(),
	now = () => new Date(),
}) {
	try {
		const base = exactOrigin(origin);
		const token = safeToken(sessionToken);
		const observed = now();
		if (!(observed instanceof Date) || Number.isNaN(observed.valueOf())) fail();
		const checks = [];

		for (const check of PERFORMANCE_CHECKS) {
			const url = new URL(check.path, base).toString();
			await timedRead({ url, sessionToken: token, fetchImpl, clock });
			const samples = [];
			for (let index = 0; index < SAMPLE_COUNT; index += 1) {
				samples.push(await timedRead({ url, sessionToken: token, fetchImpl, clock }));
			}
			const sorted = samples.toSorted((left, right) => left - right);
			const p95Ms = percentile(sorted, 0.95);
			checks.push(Object.freeze({
				name: check.name,
				path: check.path,
				status: 200,
				p50Ms: percentile(sorted, 0.5),
				p95Ms,
				maxMs: sorted.at(-1),
				targetP95Ms: check.targetP95Ms,
				outcome: p95Ms <= check.targetP95Ms ? "passed" : "failed",
			}));
		}

		return Object.freeze({
			format: FORMAT,
			host: base.host,
			observedAt: observed.toISOString(),
			outcome: checks.every((check) => check.outcome === "passed") ? "passed" : "failed",
			sampleCount: SAMPLE_COUNT,
			checks: Object.freeze(checks),
		});
	} catch (error) {
		if (error instanceof SafePerformanceEvidenceError) throw error;
		fail();
	}
}

export async function runPerformanceEvidenceCommand(args, {
	stdout = console.log,
	stderr = console.error,
	environment = process.env,
	measure = measureProductionPerformance,
} = {}) {
	if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string" || !args[0]) {
		stderr(USAGE);
		return 1;
	}
	try {
		const report = await measure({ origin: args[0], sessionToken: environment.LUMIMAIL_SESSION_TOKEN });
		for (const check of report.checks) {
			stdout(`${check.outcome === "passed" ? "PASS" : "FAIL"}  ${check.name.padEnd(13)} ` +
				`p50 ${String(check.p50Ms).padStart(7)} ms  p95 ${String(check.p95Ms).padStart(7)} ms  ` +
				`max ${String(check.maxMs).padStart(7)} ms  target ${check.targetP95Ms} ms`);
		}
		const passed = report.checks.filter((check) => check.outcome === "passed").length;
		stdout(`${report.outcome === "passed" ? "PASS" : "FAIL"}  ${passed}/${report.checks.length} production latency targets`);
		return report.outcome === "passed" ? 0 : 1;
	} catch {
		stderr(FAILURE_MESSAGE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await runPerformanceEvidenceCommand(process.argv.slice(2));
}
