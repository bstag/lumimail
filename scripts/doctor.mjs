import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
	const expectedQueues = ["INBOUND_QUEUE", "OUTBOUND_DLQ_QUEUE", "OUTBOUND_QUEUE"];
	const producersPass = exactNames(config?.queues?.producers, "binding", expectedQueues);
	const producerQueueNames = new Set((config?.queues?.producers ?? []).map((entry) => entry?.queue));
	const consumerQueueNames = new Set((config?.queues?.consumers ?? []).map((entry) => entry?.queue));
	const consumersPass = producerQueueNames.size === 3 && consumerQueueNames.size === 3 &&
		[...producerQueueNames].every((name) => consumerQueueNames.has(name));
	checks.push(check(
		"bindings.queues",
		producersPass && consumersPass,
		"Inbound, outbound, and DLQ producer/consumer bindings are complete",
		Array.isArray(config?.queues?.producers) ? config.queues.producers.length : 0,
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

	checks.sort((left, right) => left.id.localeCompare(right.id));
	const summary = {
		pass: checks.filter((entry) => entry.status === "pass").length,
		fail: checks.filter((entry) => entry.status === "fail").length,
		warn: checks.filter((entry) => entry.status === "warn").length,
	};
	return deepFreeze({
		product: "lumimail",
		mode: "local",
		ready: summary.fail === 0,
		summary,
		checks,
	});
}

function printHuman(report) {
	for (const entry of report.checks) {
		console.log(`${entry.status.toUpperCase().padEnd(4)}  ${entry.id.padEnd(24)} ${entry.summary}`);
	}
	console.log(`\n${report.summary.pass} passed, ${report.summary.fail} failed, ${report.summary.warn} warnings`);
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
		if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
		else printHuman(report);
		if (!report.ready) process.exitCode = 1;
	} catch {
		console.error("FAIL  doctor.local             Local readiness could not be evaluated safely");
		process.exitCode = 1;
	}
}
