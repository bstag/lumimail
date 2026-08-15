/**
 * Post-deployment smoke checks.
 *
 * Usage:
 *   node scripts/smoke.mjs https://mail.example.com
 *   node scripts/smoke.mjs https://mail.example.com --record-evidence
 *   node scripts/smoke.mjs                     # defaults to PUBLIC_APP_URL
 */

import { pathToFileURL } from "node:url";

import {
	observationTimestamp,
	publishFailureMessage,
	publishOperationalEvidence,
} from "./operations-evidence.mjs";

const TIMEOUT_MS = 15_000;

const CHECKS = [
	{ path: "/", expect: 200, reason: "landing page renders" },
	{ path: "/login", expect: 200, reason: "sign-in is reachable" },
	{ path: "/manifest.webmanifest", expect: 200, reason: "PWA manifest is served" },
	{ path: "/api/auth/me", expect: 401, reason: "session API refuses anonymous callers" },
	{ path: "/api/mailboxes", expect: 401, reason: "mailbox API refuses anonymous callers" },
	{ path: "/api/admin/mailboxes", expect: 401, reason: "admin API refuses anonymous callers" },
	{ path: "/api/push/config", expect: 401, reason: "push config refuses anonymous callers" },
	{ path: "/api/push/devices", expect: 401, reason: "push devices refuse anonymous callers" },
];

async function check(baseUrl, { path, expect: expected, reason }, fetchImpl) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const url = new URL(path, baseUrl).toString();
		const response = await fetchImpl(url, { signal: controller.signal, redirect: "manual" });
		return { path, reason, expected, actual: response.status, ok: response.status === expected };
	} catch (error) {
		return { path, reason, expected, actual: String(error).split("\n")[0], ok: false };
	} finally {
		clearTimeout(timer);
	}
}

export async function runSmokeCommand(args, {
	stdout = console.log,
	stderr = console.error,
	fetchImpl = fetch,
	publishEvidence = publishOperationalEvidence,
	environment = process.env,
	now = () => new Date(),
} = {}) {
	const recordFlags = args.filter((value) => value === "--record-evidence");
	const recordEvidence = recordFlags.length === 1;
	const positional = args.filter((value) => value !== "--record-evidence");
	const baseUrl = positional[0] ?? environment.PUBLIC_APP_URL;
	if (!baseUrl || positional.length > 1 || recordFlags.length > 1) {
		stderr("Usage: node scripts/smoke.mjs <base-url> [--record-evidence]   (or set PUBLIC_APP_URL)");
		return 2;
	}

	const results = [];
	for (const item of CHECKS) results.push(await check(baseUrl, item, fetchImpl));
	for (const result of results) {
		const mark = result.ok ? "PASS" : "FAIL";
		stdout(`${mark}  ${String(result.actual).padEnd(6)} ${result.path.padEnd(26)} ${result.reason}`);
	}
	const passedChecks = results.filter((result) => result.ok).length;
	stdout(`\n${passedChecks}/${results.length} passed against ${baseUrl}`);

	if (recordEvidence) {
		try {
			await publishEvidence({
				origin: baseUrl,
				sessionToken: environment.LUMIMAIL_SESSION_TOKEN,
				evidence: {
					category: "smoke",
					outcome: passedChecks === results.length ? "passed" : "failed",
					passedChecks,
					totalChecks: results.length,
					observedAt: observationTimestamp(now()),
				},
			});
		} catch (error) {
			stderr(publishFailureMessage(error));
			return 1;
		}
	}

	return passedChecks === results.length ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await runSmokeCommand(process.argv.slice(2));
}
