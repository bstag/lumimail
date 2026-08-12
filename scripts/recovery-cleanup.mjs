import { createHash } from "node:crypto";
import { execFileSync, } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	parseRecoveryManifest,
	verifyRecoveryDirectory,
} from "./recovery-manifest.mjs";

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function parseJson(label, output) {
	try {
		return JSON.parse(String(output));
	} catch {
		throw new Error(`Recovery cleanup precondition failed: ${label} returned invalid JSON`);
	}
}

function fail(message) {
	throw new Error(`Recovery cleanup precondition failed: ${message}`);
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function routingZones(output) {
	return [...String(output).matchAll(/│\s*([a-z0-9.-]+)\s*│\s*([a-z0-9-]+)\s*│\s*yes\s*│/gi)]
		.map((match) => ({ domain: match[1], zoneId: match[2] }))
		.sort((left, right) => left.domain.localeCompare(right.domain));
}

function errorText(error) {
	return [error?.message, error?.stderr, error?.stdout]
		.filter(Boolean)
		.map(String)
		.join("\n");
}

function isAbsentError(error) {
	return error?.code === "WORKER_NOT_FOUND" || error?.code === "BUCKET_NOT_FOUND" ||
		/(?:does not exist|not found|code:\s*10007|code:\s*10006)/i.test(errorText(error));
}

function assertAbsent(label, operation) {
	try {
		operation();
	} catch (error) {
		if (isAbsentError(error)) return;
		throw error;
	}
	throw new Error(`Recovery cleanup verification failed: ${label} still exists`);
}

function assertRecoveryConfig(config, target) {
	if (
		target?.configPath !== "wrangler.recovery.jsonc" ||
		config?.name !== target.workerName ||
		config?.account_id !== target.accountId ||
		config?.workers_dev !== true ||
		!Array.isArray(config?.routes) ||
		config.routes.length !== 0 ||
		config?.vars?.PUBLIC_APP_URL !== target.origin ||
		config?.vars?.R2_SWEEP_ENABLED !== "false" ||
		config?.vars?.SEED_ENABLED !== "false" ||
		["queues", "triggers", "send_email", "services"].some((key) => key in (config ?? {})) ||
		!sameJson(config?.d1_databases, [{
			binding: "DB",
			database_name: target.d1.name,
			database_id: target.d1.id,
			migrations_dir: "drizzle/migrations",
		}]) && !sameJson(config?.d1_databases, [{
			binding: "DB",
			database_name: target.d1.name,
			database_id: target.d1.id,
		}]) ||
		!sameJson(config?.r2_buckets, [{ binding: "BUCKET", bucket_name: target.r2.bucketName }])
	) {
		fail("the recovery config does not exactly describe the isolated target");
	}
}

function assertInputs({ backupDirectory, currentVersionId, production, target, recoveryConfig }) {
	let origin;
	try {
		origin = new URL(target?.origin);
	} catch {
		fail("cleanup input is invalid");
	}
	if (
		typeof backupDirectory !== "string" || !backupDirectory ||
		!UUID_PATTERN.test(currentVersionId ?? "") ||
		origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash ||
		target.accountId !== "caddde404ba5d0324c315dc5cf143696" ||
		target.workerName !== "lumimail-recovery-20260812" ||
		target.d1?.id !== "d239de97-37f1-4b9a-a664-f787ea60aa97" ||
		target.d1?.name !== "lumimail-staging" ||
		target.r2?.bucketName !== "lumimail-raw-staging" ||
		target.workerName === production?.workerName ||
		target.d1.id === production?.d1?.id ||
		target.r2.bucketName === production?.r2?.bucketName
	) {
		fail("cleanup input is invalid or overlaps production");
	}
	assertRecoveryConfig(recoveryConfig, target);
}

function assertEvidence(evidence, production) {
	const manifest = evidence?.manifest;
	if (
		!manifest ||
		manifest.source?.worker?.name !== production.workerName ||
		manifest.source?.d1?.id !== production.d1.id ||
		manifest.source?.d1?.name !== production.d1.name ||
		manifest.source?.r2?.bucketName !== production.r2.bucketName ||
		!Array.isArray(manifest.objects) ||
		new Set(manifest.objects.map((entry) => entry?.key)).size !== manifest.objects.length ||
		manifest.objects.some((entry) => !/^(?:attachments|inbound)\/[^/]+/.test(entry?.key ?? ""))
	) {
		fail("the private recovery evidence does not match the production source");
	}
	return manifest;
}

function assertActiveVersion(output, expectedVersionId) {
	const status = parseJson("recovery Worker deployment", output);
	if (
		!Array.isArray(status?.versions) || status.versions.length !== 1 ||
		status.versions[0]?.version_id !== expectedVersionId ||
		status.versions[0]?.percentage !== 100
	) {
		fail("the intended recovery Worker version must be at 100% traffic");
	}
}

function assertSmoke(result) {
	if (result?.passed !== 6 || result?.total !== 6) {
		fail("the recovery Worker must pass all six smoke checks");
	}
}

export function readProductionFingerprint(runWrangler, production) {
	const deployment = parseJson(
		"production Worker deployment",
		runWrangler(["deployments", "status", "--config", "wrangler.jsonc", "--json"]),
	);
	const databases = parseJson(
		"production D1 inventory",
		runWrangler(["d1", "list", "--config", "wrangler.recovery.jsonc", "--json"]),
	);
	const database = databases.find((entry) => entry?.uuid === production.d1.id);
	const bucket = parseJson(
		"production R2 inventory",
		runWrangler(["r2", "bucket", "info", production.r2.bucketName, "--config", "wrangler.recovery.jsonc", "--json"]),
	);
	const queues = String(runWrangler(["queues", "list", "--config", "wrangler.recovery.jsonc"]));
	if (database?.name !== production.d1.name || bucket?.name !== production.r2.bucketName ||
		production.queueNames.some((name) => !queues.includes(name))) {
		fail("production resource identities are incomplete");
	}
	const zoneOutput = String(runWrangler(["email", "routing", "list"]));
	const routeOutputs = routingZones(zoneOutput).map((zone) => String(runWrangler([
		"email", "routing", "rules", "list", zone.domain, "--zone-id", zone.zoneId,
	])));
	return {
		workerVersions: (deployment.versions ?? []).map((entry) => ({
			versionId: entry.version_id,
			percentage: entry.percentage,
		})).sort((left, right) => left.versionId.localeCompare(right.versionId)),
		d1: { id: database.uuid, name: database.name },
		r2: {
			name: bucket.name,
			created: bucket.created,
			location: bucket.location,
			storageClass: bucket.default_storage_class,
		},
		queueNames: [...production.queueNames].sort(),
		routingSha256: createHash("sha256")
			.update([zoneOutput, ...routeOutputs].join("\n").replaceAll("\r\n", "\n"))
			.digest("hex"),
	};
}

function defaultLoadEvidence(backupDirectory) {
	const directory = resolve(backupDirectory);
	const verification = verifyRecoveryDirectory(directory);
	if (verification.problems.length > 0) {
		fail(`the private recovery directory has ${verification.problems.length} integrity problems`);
	}
	return {
		manifest: parseRecoveryManifest(readFileSync(join(directory, "manifest.json"), "utf8")),
	};
}

export function runRecoveryCleanup({
	backupDirectory,
	currentVersionId,
	production,
	recoveryConfig,
	target,
	loadEvidence = defaultLoadEvidence,
	runWrangler,
	runSmoke,
	readProductionFingerprint: fingerprintReader = readProductionFingerprint,
}) {
	if (typeof loadEvidence !== "function" || typeof runWrangler !== "function" ||
		typeof runSmoke !== "function" || typeof fingerprintReader !== "function") {
		fail("cleanup input is invalid");
	}
	assertInputs({ backupDirectory, currentVersionId, production, target, recoveryConfig });
	const manifest = assertEvidence(loadEvidence(backupDirectory), production);

	assertActiveVersion(
		runWrangler(["deployments", "status", "--config", target.configPath, "--json"]),
		currentVersionId,
	);
	const databases = parseJson(
		"recovery D1 inventory",
		runWrangler(["d1", "list", "--config", target.configPath, "--json"]),
	);
	if (!databases.some((entry) => entry?.uuid === target.d1.id && entry?.name === target.d1.name)) {
		fail("the exact recovery D1 database is absent");
	}
	const bucket = parseJson(
		"recovery R2 inventory",
		runWrangler(["r2", "bucket", "info", target.r2.bucketName, "--config", target.configPath, "--json"]),
	);
	if (bucket?.name !== target.r2.bucketName || Number(bucket.object_count) !== manifest.objects.length) {
		fail("the recovery R2 bucket count does not equal the manifest");
	}
	const zones = routingZones(runWrangler(["email", "routing", "list"]));
	for (const zone of zones) {
		const rules = String(runWrangler([
			"email", "routing", "rules", "list", zone.domain, "--zone-id", zone.zoneId,
		]));
		if (rules.includes(`worker:${target.workerName}`)) {
			fail("the recovery Worker still receives Email Routing traffic");
		}
	}
	assertSmoke(runSmoke(target.origin));
	const before = fingerprintReader(runWrangler, production);

	runWrangler(["delete", target.workerName, "--config", target.configPath], { input: "y\n" });
	for (const entry of manifest.objects) {
		runWrangler([
			"r2", "object", "delete", `${target.r2.bucketName}/${entry.key}`,
			"--config", target.configPath, "--remote", "--force",
		]);
	}
	runWrangler(["r2", "bucket", "delete", target.r2.bucketName, "--config", target.configPath]);
	runWrangler(["d1", "delete", target.d1.name, "--config", target.configPath, "--skip-confirmation"]);

	assertAbsent("recovery Worker", () => runWrangler([
		"deployments", "status", "--config", target.configPath, "--json",
	]));
	assertAbsent("recovery R2 bucket", () => runWrangler([
		"r2", "bucket", "info", target.r2.bucketName, "--config", target.configPath, "--json",
	]));
	const remainingDatabases = parseJson(
		"post-cleanup D1 inventory",
		runWrangler(["d1", "list", "--config", target.configPath, "--json"]),
	);
	if (remainingDatabases.some((entry) => entry?.uuid === target.d1.id || entry?.name === target.d1.name)) {
		throw new Error("Recovery cleanup verification failed: recovery D1 still exists");
	}
	const after = fingerprintReader(runWrangler, production);
	if (!sameJson(before, after)) {
		throw new Error("Recovery cleanup verification failed: production inventory changed");
	}

	return {
		workerName: target.workerName,
		d1Id: target.d1.id,
		r2BucketName: target.r2.bucketName,
		deletedObjectCount: manifest.objects.length,
		productionFingerprintUnchanged: true,
	};
}

function wrangler(args, options = {}) {
	return execFileSync(
		process.execPath,
		[resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
		{
			env: process.env,
			input: options.input,
			stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
		},
	);
}

function smoke(origin) {
	const output = String(execFileSync(process.execPath, [resolve("scripts/smoke.mjs"), origin], {
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	}));
	const match = /(?:^|\n)(\d+)\/(\d+) passed against /m.exec(output);
	if (!match) throw new Error("Recovery smoke output was malformed");
	return { passed: Number(match[1]), total: Number(match[2]) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const backupDirectory = process.argv[2];
	const currentVersionId = process.argv[3];
	if (!backupDirectory || !currentVersionId) {
		console.error("Usage: node scripts/recovery-cleanup.mjs <backup-directory> <current-version-id>");
		process.exitCode = 1;
	} else {
		try {
			const target = {
				accountId: "caddde404ba5d0324c315dc5cf143696",
				workerName: "lumimail-recovery-20260812",
				configPath: "wrangler.recovery.jsonc",
				origin: "https://lumimail-recovery-20260812.blackstag.workers.dev",
				d1: { id: "d239de97-37f1-4b9a-a664-f787ea60aa97", name: "lumimail-staging" },
				r2: { bucketName: "lumimail-raw-staging" },
			};
			const result = runRecoveryCleanup({
				backupDirectory,
				currentVersionId,
				target,
				production: {
					workerName: "lumimail",
					d1: { id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42", name: "lumimail-prod" },
					r2: { bucketName: "lumimail-raw-prod" },
					queueNames: ["lumimail-inbound-prod", "lumimail-outbound-prod", "lumimail-outbound-dlq-prod"],
				},
				recoveryConfig: JSON.parse(readFileSync(target.configPath, "utf8")),
				runWrangler: wrangler,
				runSmoke: smoke,
			});
			console.log(JSON.stringify(result, null, 2));
		} catch (error) {
			console.error(error instanceof Error ? error.message : "Recovery cleanup failed");
			process.exitCode = 1;
		}
	}
}
