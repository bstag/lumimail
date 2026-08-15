import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SMOKE_CHECK_COUNT } from "./operations-evidence.mjs";

// The deployed queue contract, matching tests/unit/wrangler-local-bindings.test.ts.
export const REQUIRED_QUEUE_BINDINGS = [
	"INBOUND_QUEUE",
	"OUTBOUND_DLQ_QUEUE",
	"OUTBOUND_QUEUE",
	"PUSH_DLQ_QUEUE",
	"PUSH_QUEUE",
];

function deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

function check(id, passed, summary, observed) {
	return {
		id,
		status: passed ? "pass" : "fail",
		summary,
		...(observed === undefined ? {} : { observed }),
	};
}

function summarize(checks, mode) {
	checks.sort((left, right) => left.id.localeCompare(right.id));
	const summary = {
		pass: checks.filter((entry) => entry.status === "pass").length,
		fail: checks.filter((entry) => entry.status === "fail").length,
		warn: checks.filter((entry) => entry.status === "warn").length,
	};
	return deepFreeze({
		product: "lumimail",
		mode,
		ready: summary.fail === 0,
		summary,
		checks,
	});
}

function nodeRequirement(engine) {
	const match = /^>=(\d+)$/.exec(engine ?? "");
	return match ? Number(match[1]) : null;
}

function migrationSequence(names) {
	if (!Array.isArray(names) || names.length === 0) return null;
	const prefixes = names.map((name) => /^(\d{4})_[a-z0-9_]+\.sql$/i.exec(name)?.[1]);
	if (prefixes.some((prefix) => !prefix)) return null;
	const numbers = prefixes.map(Number).sort((left, right) => left - right);
	if (numbers[0] !== 0 || new Set(numbers).size !== numbers.length) return null;
	for (let index = 0; index < numbers.length; index += 1) {
		if (numbers[index] !== index) return null;
	}
	return `${String(numbers[0]).padStart(4, "0")}..${String(numbers.at(-1)).padStart(4, "0")}`;
}

function exactNames(entries, property, expected) {
	if (!Array.isArray(entries)) return false;
	const observed = entries.map((entry) => entry?.[property]).sort();
	return JSON.stringify(observed) === JSON.stringify([...expected].sort());
}

function safeOrigin(config) {
	let origin;
	try {
		origin = new URL(config?.vars?.PUBLIC_APP_URL);
	} catch {
		return false;
	}
	return origin.protocol === "https:" && origin.pathname === "/" && !origin.search && !origin.hash &&
		config.routes?.length === 1 && config.routes[0]?.custom_domain === true &&
		config.routes[0]?.pattern === origin.hostname;
}

export function buildLocalDoctorReport({
	nodeVersion,
	packageManifest,
	config,
	migrationNames,
	requiredPaths,
}) {
	const checks = [];
	const requiredNode = nodeRequirement(packageManifest?.engines?.node);
	const currentNode = /^(\d+)\./.exec(nodeVersion ?? "")?.[1];
	checks.push(check(
		"runtime.node",
		requiredNode !== null && currentNode !== undefined && Number(currentNode) >= requiredNode,
		"Node runtime satisfies package requirements",
		typeof nodeVersion === "string" ? nodeVersion : "unknown",
	));

	checks.push(check(
		"config.worker",
		config?.name === "lumimail" && /(?:^|[\\/])worker\.ts$/.test(config?.main ?? ""),
		"Production Worker identity and entry point are exact",
	));
	checks.push(check(
		"config.routes",
		safeOrigin(config),
		"Public HTTPS origin matches the single custom domain",
		Array.isArray(config?.routes) ? config.routes.length : 0,
	));
	checks.push(check(
		"config.compatibility",
		/^\d{4}-\d{2}-\d{2}$/.test(config?.compatibility_date ?? ""),
		"Worker compatibility date is explicit",
		config?.compatibility_date ?? "missing",
	));
	checks.push(check(
		"bindings.d1",
		exactNames(config?.d1_databases, "binding", ["DB"]),
		"Exactly one production D1 binding is configured",
		Array.isArray(config?.d1_databases) ? config.d1_databases.length : 0,
	));
	checks.push(check(
		"bindings.r2",
		exactNames(config?.r2_buckets, "binding", ["BUCKET"]),
		"Exactly one production R2 binding is configured",
		Array.isArray(config?.r2_buckets) ? config.r2_buckets.length : 0,
	));
	const producers = config?.queues?.producers;
	const producersPass = exactNames(producers, "binding", REQUIRED_QUEUE_BINDINGS);
	const producerQueueNames = new Set((producers ?? []).map((entry) => entry?.queue));
	const consumerQueueNames = new Set((config?.queues?.consumers ?? []).map((entry) => entry?.queue));
	// Every produced queue must be uniquely named and consumed. The counts follow the
	// required binding list rather than a literal, so adding a queue pair to the
	// contract cannot leave this gate asserting an outdated size.
	const consumersPass = Array.isArray(producers) && producerQueueNames.size === producers.length &&
		consumerQueueNames.size === producerQueueNames.size &&
		[...producerQueueNames].every((name) => consumerQueueNames.has(name));
	checks.push(check(
		"bindings.queues",
		producersPass && consumersPass,
		"Mail, push, and dead-letter producer/consumer bindings are complete",
		Array.isArray(producers) ? producers.length : 0,
	));
	checks.push(check(
		"bindings.cron",
		JSON.stringify(config?.triggers?.crons) === JSON.stringify(["* * * * *"]),
		"The required scheduled trigger is configured",
		Array.isArray(config?.triggers?.crons) ? config.triggers.crons.length : 0,
	));
	checks.push(check(
		"bindings.email",
		exactNames(config?.send_email, "name", ["EMAIL"]),
		"Email Sending binding is configured",
		Array.isArray(config?.send_email) ? config.send_email.length : 0,
	));
	checks.push(check(
		"bindings.service",
		exactNames(config?.services, "binding", ["WORKER_SELF_REFERENCE"]) &&
		config?.services?.[0]?.service === "lumimail",
		"Worker self-reference binding is exact",
		Array.isArray(config?.services) ? config.services.length : 0,
	));
	checks.push(check(
		"config.provider",
		["cloudflare", "resend"].includes(config?.vars?.MAIL_PROVIDER) &&
		config?.vars?.CF_EMAIL_WORKER_NAME === "lumimail",
		"Selected outbound provider and Worker routing identity are supported",
		config?.vars?.MAIL_PROVIDER ?? "missing",
	));

	const sequence = migrationSequence(migrationNames);
	checks.push(check(
		"migrations.sequence",
		sequence !== null,
		"Migration prefixes are unique and contiguous from 0000",
		sequence ?? "invalid",
	));
	for (const [id, present] of Object.entries(requiredPaths ?? {})) {
		checks.push(check(`path.${id}`, present === true, `Required ${id} path is present`));
	}

	return summarize(checks, "local");
}

function safeJson(output) {
	try {
		return JSON.parse(String(output));
	} catch {
		return null;
	}
}

function remoteOrigin(origin, config) {
	let parsed;
	try {
		parsed = new URL(origin);
	} catch {
		return null;
	}
	if (
		parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash ||
		origin !== config?.vars?.PUBLIC_APP_URL || parsed.username || parsed.password
	) return null;
	return parsed;
}

function mailDomain(config, origin) {
	const value = config?.vars?.PASSWORD_RESET_FROM;
	const separator = typeof value === "string" ? value.lastIndexOf("@") : -1;
	const domain = separator >= 0 ? value.slice(separator + 1).toLowerCase() : "";
	return domain && (origin.hostname === domain || origin.hostname.endsWith(`.${domain}`)) ? domain : null;
}

function addRemoteCheck(checks, id, summary, operation, observed) {
	let passed = false;
	let safeObserved;
	try {
		const result = operation();
		passed = result === true || (typeof result === "object" && result?.passed === true);
		safeObserved = typeof observed === "function" ? observed(result) : observed;
	} catch {
		passed = false;
	}
	checks.push(check(id, passed, summary, safeObserved));
}

function queueSecondPageIsEmpty(output) {
	const meaningful = String(output)
		.replaceAll(/\x1b\[[0-9;]*m/g, "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !/^(?:☁|⛅|─+$|wrangler\s|▲|WARNING|Logs were written)/i.test(line));
	return meaningful.length === 0;
}

function bindingMatches(bindings, expected) {
	return Array.isArray(bindings) && expected.every((entry) => bindings.some((binding) =>
		binding?.name === entry.name && binding?.type === entry.type &&
		(entry.databaseId === undefined || binding?.database_id === entry.databaseId) &&
		(entry.bucketName === undefined || binding?.bucket_name === entry.bucketName) &&
		(entry.queueName === undefined || binding?.queue_name === entry.queueName) &&
		(entry.service === undefined || binding?.service === entry.service)
	));
}

// Fixed classes only. An operator needs to tell an absent credential from a real
// schedule mismatch, but provider text must never become an egress path.
const CRON_FAILURE_REASONS = {
	dependency: "the active Worker version could not be proven",
	config: "configuration does not define exactly one schedule",
	credential: "no usable Wrangler session or API token for the schedule read",
	provider: "provider rejected the schedule read",
	unreadable: "schedule inventory was unreadable",
	mismatch: "live schedule does not match configuration",
};

function classifyLiveSchedule(response, expected) {
	if (response === null || response === undefined) return "credential";
	if (typeof response !== "object") return "unreadable";
	if (response.success !== true || !Array.isArray(response.errors) || response.errors.length > 0) return "provider";
	// Cloudflare returns the list under `result.schedules`; tolerate a bare
	// `result` array so an API shape change reports a mismatch, not a false pass.
	const schedules = Array.isArray(response.result) ? response.result : response.result?.schedules;
	if (!Array.isArray(schedules)) return "unreadable";
	const observed = schedules.map((entry) => entry?.cron);
	if (observed.some((cron) => typeof cron !== "string")) return "unreadable";
	if (observed.length !== expected.length ||
		JSON.stringify([...observed].sort()) !== JSON.stringify([...expected].sort())) return "mismatch";
	return null;
}

export function runRemoteDoctor({ localReport, config, origin, runWrangler, runSmoke, readSchedules }) {
	const checks = (localReport?.checks ?? []).map((entry) => ({ ...entry }));
	const parsedOrigin = remoteOrigin(origin, config);
	const domain = parsedOrigin ? mailDomain(config, parsedOrigin) : null;
	if (
		localReport?.product !== "lumimail" || localReport?.mode !== "local" ||
		!parsedOrigin || !domain || typeof runWrangler !== "function" || typeof runSmoke !== "function" ||
		typeof readSchedules !== "function"
	) {
		checks.push(check("remote.input", false, "Remote origin and production configuration are exact"));
		return summarize(checks, "remote");
	}

	let versionId;
	let scheduledHandlerObserved = false;
	addRemoteCheck(checks, "remote.deployment", "Exactly one active Worker version receives 100% traffic", () => {
		const deployment = safeJson(runWrangler(["deployments", "status", "--config", "wrangler.jsonc", "--json"]));
		if (!Array.isArray(deployment?.versions) || deployment.versions.length !== 1 ||
			deployment.versions[0]?.percentage !== 100 || typeof deployment.versions[0]?.version_id !== "string") return false;
		versionId = deployment.versions[0].version_id;
		return true;
	}, (passed) => passed ? 1 : 0);

	addRemoteCheck(checks, "remote.version", "The active version has exact handlers and critical bindings", () => {
		if (!versionId) return false;
		const version = safeJson(runWrangler(["versions", "view", versionId, "--config", "wrangler.jsonc", "--json"]));
		const handlers = version?.resources?.script?.handlers;
		scheduledHandlerObserved = Array.isArray(handlers) && handlers.includes("scheduled");
		const expectedHandlers = ["email", "fetch", "queue", "scheduled"];
		const d1 = config.d1_databases[0];
		const r2 = config.r2_buckets[0];
		const expectedBindings = [
			{ name: "DB", type: "d1", databaseId: d1.database_id },
			{ name: "BUCKET", type: "r2_bucket", bucketName: r2.bucket_name },
			{ name: "EMAIL", type: "send_email" },
			...config.queues.producers.map((entry) => ({ name: entry.binding, type: "queue", queueName: entry.queue })),
			{ name: "WORKER_SELF_REFERENCE", type: "service", service: "lumimail" },
		];
		return version?.id === versionId &&
			JSON.stringify([...(handlers ?? [])].sort()) === JSON.stringify(expectedHandlers) &&
			version?.resources?.script_runtime?.compatibility_date === config.compatibility_date &&
			bindingMatches(version?.resources?.bindings, expectedBindings);
	});
	const expectedCrons = config?.triggers?.crons;
	// A passing remote.version already proves the scheduled handler, so an unproven
	// version must be reported as an unmet dependency rather than blamed on the
	// schedule read or on a handler this check never actually observed.
	const versionProven = checks.find((entry) => entry.id === "remote.version")?.status === "pass";
	let cronReason = null;
	if (!versionProven || !scheduledHandlerObserved) {
		cronReason = "dependency";
	} else if (!Array.isArray(expectedCrons) || expectedCrons.length !== 1) {
		cronReason = "config";
	} else {
		try {
			cronReason = classifyLiveSchedule(readSchedules(), expectedCrons);
		} catch {
			cronReason = "unreadable";
		}
	}
	checks.push(check(
		"remote.cron",
		cronReason === null,
		cronReason === null
			? "The live Cron schedule matches configuration and the active version handles it"
			: `Live Cron schedule is not proven: ${CRON_FAILURE_REASONS[cronReason]}`,
		cronReason === null ? 1 : 0,
	));

	addRemoteCheck(checks, "remote.d1", "The configured production D1 database exists", () => {
		const expected = config.d1_databases[0];
		const info = safeJson(runWrangler(["d1", "info", expected.database_name, "--config", "wrangler.jsonc", "--json"]));
		return info?.uuid === expected.database_id && info?.name === expected.database_name && Number.isInteger(info?.num_tables);
	}, (passed) => passed ? 1 : 0);

	addRemoteCheck(checks, "remote.migrations", "Production D1 has no pending migrations", () =>
		/No migrations to apply!/i.test(String(runWrangler([
			"d1", "migrations", "list", "DB", "--config", "wrangler.jsonc", "--remote",
		]))));

	addRemoteCheck(checks, "remote.r2", "The configured production R2 bucket exists", () => {
		const expected = config.r2_buckets[0];
		const info = safeJson(runWrangler(["r2", "bucket", "info", expected.bucket_name, "--config", "wrangler.jsonc", "--json"]));
		return info?.name === expected.bucket_name && Number.isInteger(Number(info?.object_count));
	}, (passed) => passed ? 1 : 0);

	addRemoteCheck(checks, "remote.queues", "All configured Queues are unique and the inventory is complete", () => {
		const first = String(runWrangler(["queues", "list", "--config", "wrangler.jsonc", "--page", "1"]));
		const second = String(runWrangler(["queues", "list", "--config", "wrangler.jsonc", "--page", "2"]));
		const names = config.queues.producers.map((entry) => entry.queue);
		return new Set(names).size === names.length && names.every((name) => first.includes(name)) && queueSecondPageIsEmpty(second);
	}, (passed) => passed ? config.queues.producers.length : 0);

	addRemoteCheck(checks, "remote.secrets", "Required provider secrets are present by name", () => {
		const secrets = safeJson(runWrangler(["secret", "list", "--config", "wrangler.jsonc", "--format", "json"]));
		const required = config.vars.MAIL_PROVIDER === "resend" ? ["RESEND_API_KEY"] : ["CF_TOKEN"];
		return Array.isArray(secrets) && required.every((name) =>
			secrets.some((entry) => entry?.name === name && entry?.type === "secret_text"));
	}, (passed) => passed ? 1 : 0);

	addRemoteCheck(checks, "remote.email-routing", "Email Routing is enabled and targets the production Worker", () => {
		const zones = String(runWrangler(["email", "routing", "list"]));
		const escaped = domain.replaceAll(".", "\\.");
		const match = new RegExp(`│\\s*${escaped}\\s*│\\s*([a-z0-9-]+)\\s*│\\s*yes\\s*│`, "i").exec(zones);
		if (!match) return false;
		const zoneId = match[1];
		const rules = String(runWrangler(["email", "routing", "rules", "list", domain, "--zone-id", zoneId]));
		return rules.includes(`worker:${config.name}`) && /Enabled:\s*true/i.test(rules) &&
			/Catch-all rule:\s*enabled, action:\s*worker:/i.test(rules);
	});

	addRemoteCheck(checks, "remote.email-sending", "Email Sending is enabled for the production domain", () => {
		const settings = String(runWrangler(["email", "sending", "settings", domain]));
		return new RegExp(`Email Sending for ${domain.replaceAll(".", "\\.")}:`, "i").test(settings) &&
			/Enabled:\s*true/i.test(settings);
	});

	addRemoteCheck(checks, "remote.smoke", "Every public smoke check in the complete contract passes", () => {
		const result = runSmoke(origin);
		return {
			passed: result?.total === SMOKE_CHECK_COUNT && result?.passed === SMOKE_CHECK_COUNT,
			count: result?.passed,
		};
	}, (result) => result?.count ?? 0);

	return summarize(checks, "remote");
}

// `npm run doctor -- --remote <origin>` can lose the flag to npm or PowerShell argument
// handling, which previously ran the local report and looked like a successful remote
// run. A bare HTTPS origin therefore also selects remote mode, and an explicit flag with
// no usable origin stays in remote mode so the run fails rather than quietly downgrading.
export function parseDoctorArgs(argv) {
	const args = (Array.isArray(argv) ? argv : []).filter((value) => typeof value === "string");
	const json = args.includes("--json");
	const flagIndex = args.indexOf("--remote");
	if (flagIndex >= 0) {
		const next = args[flagIndex + 1];
		return { remote: true, origin: next && !next.startsWith("--") ? next : undefined, json };
	}
	const positional = args.find((value) => value.startsWith("https://"));
	return { remote: positional !== undefined, origin: positional, json };
}

function printHuman(report) {
	console.log(`Mode: ${report.mode}${report.mode === "local" ? " (configuration only; no provider or public checks ran)" : ""}\n`);
	for (const entry of report.checks) {
		console.log(`${entry.status.toUpperCase().padEnd(4)}  ${entry.id.padEnd(24)} ${entry.summary}`);
	}
	console.log(`\n${report.summary.pass} passed, ${report.summary.fail} failed, ${report.summary.warn} warnings`);
}

function wrangler(args) {
	return execFileSync(
		process.execPath,
		[resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
		{ env: process.env, stdio: ["ignore", "pipe", "pipe"] },
	);
}

function smoke(origin) {
	const output = String(execFileSync(process.execPath, [resolve("scripts/smoke.mjs"), origin], {
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	}));
	const match = /(?:^|\n)(\d+)\/(\d+) passed against /m.exec(output);
	if (!match) return { passed: 0, total: 0 };
	return { passed: Number(match[1]), total: Number(match[2]) };
}

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;

/**
 * Extracts the access token from a Wrangler auth profile. Returns null when the
 * profile has no token or is provably expired, so a stale session is reported as
 * an absent credential rather than as a provider rejection. The value is only ever
 * used as a request header; it is never logged, printed, or placed in the report.
 */
export function parseWranglerSession(text, now) {
	const source = typeof text === "string" ? text : "";
	const token = /^\s*oauth_token\s*=\s*"([^"]+)"/m.exec(source)?.[1];
	if (!token) return null;
	const expiresAt = Date.parse(/^\s*expiration_time\s*=\s*"([^"]*)"/m.exec(source)?.[1] ?? "");
	return Number.isFinite(expiresAt) && expiresAt <= now ? null : token;
}

function wranglerProfilePaths() {
	const directories = [];
	if (process.env.XDG_CONFIG_HOME) directories.push(join(process.env.XDG_CONFIG_HOME, ".wrangler"));
	if (process.platform === "win32" && process.env.APPDATA) {
		directories.push(join(process.env.APPDATA, "xdg.config", ".wrangler"));
	}
	directories.push(join(homedir(), ".config", ".wrangler"), join(homedir(), ".wrangler"));
	return directories.map((directory) => join(directory, "config", "default.toml"));
}

/**
 * Prefers an explicit API token, matching Wrangler's own precedence, and otherwise
 * reuses the interactive Wrangler session. Requiring a separate token for this one
 * read would also displace the operator's login for every other provider check.
 */
function operatorCredential(warmSession) {
	if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
	// One authenticated Wrangler call first, so an access token that expired since
	// the last run is refreshed on disk before it is read.
	try {
		warmSession();
	} catch {
		// An unauthenticated CLI simply yields no stored session below.
	}
	for (const path of wranglerProfilePaths()) {
		try {
			const session = parseWranglerSession(readFileSync(path, "utf8"), Date.now());
			if (session) return session;
		} catch {
			continue;
		}
	}
	return null;
}

// Wrangler 4.114 can only mutate triggers, so the live schedule inventory is read
// straight from the provider. The account and script identity come from committed
// configuration; only the credential comes from the environment.
async function fetchLiveSchedules(config, warmSession) {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? config?.vars?.CF_ACCOUNT_ID;
	const token = operatorCredential(warmSession);
	// `null` is the credential-absent signal. Anything past this point had a
	// credential, so a rejection or transport failure must not read as one.
	if (!ACCOUNT_ID_PATTERN.test(String(accountId)) || !token || typeof config?.name !== "string") return null;
	const providerFailure = { success: false, errors: [{}] };
	try {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(config.name)}/schedules`,
			{
				headers: { accept: "application/json", authorization: `Bearer ${token}` },
				redirect: "error",
			},
		);
		if (!response.ok) return providerFailure;
		return await response.json();
	} catch {
		return providerFailure;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const { unstable_readConfig } = await import("wrangler");
		const config = unstable_readConfig({ config: "wrangler.jsonc" }, { hideWarnings: true });
		const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
		const report = buildLocalDoctorReport({
			nodeVersion: process.versions.node,
			packageManifest,
			config,
			migrationNames: readdirSync("drizzle/migrations").filter((name) => name.endsWith(".sql")),
			requiredPaths: {
				"worker.entry": existsSync("worker.ts"),
				"smoke.script": existsSync("scripts/smoke.mjs"),
				"recovery.manifest": existsSync("scripts/recovery-manifest.mjs"),
			},
		});
		const { remote, origin: requestedOrigin, json } = parseDoctorArgs(process.argv.slice(2));
		// Read the live schedule only once the requested origin already matches the
		// configured production origin, so an unintended origin still reaches no provider.
		const liveSchedules = requestedOrigin && requestedOrigin === config?.vars?.PUBLIC_APP_URL
			? await fetchLiveSchedules(config, () => wrangler(["whoami"]))
			: null;
		const finalReport = remote
			? runRemoteDoctor({
				localReport: report,
				config,
				origin: requestedOrigin,
				runWrangler: wrangler,
				runSmoke: smoke,
				readSchedules: () => liveSchedules,
			})
			: report;
		if (json) console.log(JSON.stringify(finalReport, null, 2));
		else printHuman(finalReport);
		if (!finalReport.ready) process.exitCode = 1;
	} catch {
		console.error("FAIL  doctor.local             Local readiness could not be evaluated safely");
		process.exitCode = 1;
	}
}
