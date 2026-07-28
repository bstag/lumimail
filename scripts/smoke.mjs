/**
 * Post-deployment smoke checks.
 *
 * These were previously typed by hand after each deploy and pasted into the
 * remediation log, which made them an operator habit rather than a test — nothing
 * recorded which checks ran, and nothing failed if one was skipped.
 *
 * Deliberately shallow. It answers "did this deployment come up, and is it refusing
 * anonymous access", not "does the product work" — that is what the E2E suites are
 * for. Everything here is unauthenticated, so it is safe to point at production.
 *
 * Usage:
 *   node scripts/smoke.mjs https://mail.example.com
 *   node scripts/smoke.mjs                     # defaults to PUBLIC_APP_URL
 */

const TIMEOUT_MS = 15_000;

/** Each check is a path, the status it must return, and why that matters. */
const CHECKS = [
	{ path: "/", expect: 200, reason: "landing page renders" },
	{ path: "/login", expect: 200, reason: "sign-in is reachable" },
	{ path: "/manifest.webmanifest", expect: 200, reason: "PWA manifest is served" },
	{ path: "/api/auth/me", expect: 401, reason: "session API refuses anonymous callers" },
	{ path: "/api/mailboxes", expect: 401, reason: "mailbox API refuses anonymous callers" },
	{ path: "/api/admin/mailboxes", expect: 401, reason: "admin API refuses anonymous callers" },
];

async function check(baseUrl, { path, expect: expected, reason }) {
	const url = new URL(path, baseUrl).toString();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
		return { path, reason, expected, actual: response.status, ok: response.status === expected };
	} catch (error) {
		return { path, reason, expected, actual: String(error).split("\n")[0], ok: false };
	} finally {
		clearTimeout(timer);
	}
}

const baseUrl = process.argv[2] ?? process.env.PUBLIC_APP_URL;
if (!baseUrl) {
	console.error("Usage: node scripts/smoke.mjs <base-url>   (or set PUBLIC_APP_URL)");
	process.exit(2);
}

const results = [];
for (const item of CHECKS) results.push(await check(baseUrl, item));

for (const result of results) {
	const mark = result.ok ? "PASS" : "FAIL";
	console.log(`${mark}  ${String(result.actual).padEnd(6)} ${result.path.padEnd(26)} ${result.reason}`);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed against ${baseUrl}`);

// A non-zero exit is the point: this is meant to gate a deployment, not inform one.
process.exit(failed.length === 0 ? 0 : 1);
