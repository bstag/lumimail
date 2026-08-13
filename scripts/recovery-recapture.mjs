import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { extractR2Keys, keyToPath } from "./r2-backup.mjs";
import { canonicalizeRecoveryManifest, verifyRecoveryDirectory } from "./recovery-manifest.mjs";

const RECOVERY = Object.freeze({
	accountId: "caddde404ba5d0324c315dc5cf143696",
	workerName: "lumimail-recovery-20260812",
	configPath: "wrangler.recovery.jsonc",
	origin: "https://lumimail-recovery-20260812.blackstag.workers.dev",
	d1: Object.freeze({ id: "d239de97-37f1-4b9a-a664-f787ea60aa97", name: "lumimail-staging" }),
	r2: Object.freeze({ bucketName: "lumimail-raw-staging", objectCount: 15 }),
});

const ORIGINAL = Object.freeze({
	accountId: RECOVERY.accountId,
	worker: Object.freeze({
		name: "lumimail",
		versionId: "721ad103-ec5a-4b0d-a48c-f664d6814451",
		scriptEtag: "5bd0e61aed0aa76c3173ab81b708572df8a6362879965d37887e4f77209947c6",
		compatibilityDate: "2026-07-22",
	}),
	d1: Object.freeze({ id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42", name: "lumimail-prod", bookmark: null }),
	r2: Object.freeze({ bucketName: "lumimail-raw-prod" }),
	application: Object.freeze({
		gitCommit: "f4c48dbb71b0be27a0cbbdaffb4f639780858f7c",
		schemaVersion: "0028",
	}),
});

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function assertRecoveryConfig(config) {
	if (config?.name !== RECOVERY.workerName || config?.account_id !== RECOVERY.accountId ||
		config?.workers_dev !== true || !sameJson(config?.routes, []) ||
		config?.vars?.PUBLIC_APP_URL !== RECOVERY.origin || config?.vars?.R2_SWEEP_ENABLED !== "false" ||
		config?.vars?.SEED_ENABLED !== "false" ||
		!sameJson(config?.d1_databases, [{ binding: "DB", database_name: RECOVERY.d1.name,
			database_id: RECOVERY.d1.id, migrations_dir: "drizzle/migrations" }]) ||
		!sameJson(config?.r2_buckets, [{ binding: "BUCKET", bucket_name: RECOVERY.r2.bucketName }])) {
		throw new Error("Recovery recapture configuration does not match the exact isolated target");
	}
}

function parseJson(label, output) {
	try {
		return JSON.parse(String(output));
	} catch {
		throw new Error(`Recovery recapture ${label} was malformed`);
	}
}

function errorText(error) {
	return [error?.message, error?.stderr, error?.stdout].filter(Boolean).map(String).join("\n");
}

function isExactWorkerAbsence(error) {
	return /\[code:\s*10007\]/i.test(errorText(error));
}

function providerRead(runWrangler, label, args) {
	try {
		return runWrangler(args);
	} catch {
		throw new Error(`Recovery recapture ${label} could not be read`);
	}
}

function routingZones(output) {
	return [...String(output).matchAll(/│\s*([a-z0-9.-]+)\s*│\s*([a-z0-9-]+)\s*│\s*yes\s*│/gi)]
		.map((match) => ({ domain: match[1], zoneId: match[2] }));
}

function fileEvidence(path) {
	const bytes = readFileSync(path);
	return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function assertMetadataPreflight(runWrangler) {
	try {
		runWrangler(["deployments", "status", "--config", RECOVERY.configPath, "--json"]);
	} catch (error) {
		if (isExactWorkerAbsence(error)) {
			const databases = parseJson("D1 inventory",
				providerRead(runWrangler, "D1 inventory",
					["d1", "list", "--config", RECOVERY.configPath, "--json"]));
			if (!Array.isArray(databases) || databases.filter((entry) =>
				entry?.uuid === RECOVERY.d1.id && entry?.name === RECOVERY.d1.name).length !== 1) {
				throw new Error("Recovery recapture exact D1 target is absent");
			}
			const bucket = parseJson("R2 inventory", providerRead(runWrangler, "R2 inventory", [
				"r2", "bucket", "info", RECOVERY.r2.bucketName, "--config", RECOVERY.configPath, "--json",
			]));
			if (bucket?.name !== RECOVERY.r2.bucketName || Number(bucket.object_count) !== RECOVERY.r2.objectCount) {
				throw new Error("Recovery recapture requires the exact bucket with 15 objects");
			}
			const zones = routingZones(providerRead(runWrangler, "Email Routing inventory",
				["email", "routing", "list"]));
			for (const zone of zones) {
				const rules = String(providerRead(runWrangler, "Email Routing rules", [
					"email", "routing", "rules", "list", zone.domain, "--zone-id", zone.zoneId,
				]));
				if (rules.includes(`worker:${RECOVERY.workerName}`)) {
					throw new Error("Recovery recapture Worker still receives Email Routing traffic");
				}
			}
			return;
		}
	}
	throw new Error("Recovery recapture requires exact recovery Worker absence");
}

export function recaptureRecovery({
	outputDirectory,
	gitClean,
	recoveryConfig,
	now = () => new Date(),
	runWrangler,
}) {
	const finalDirectory = resolve(outputDirectory);
	if (!gitClean) throw new Error("Git worktree must be clean before recovery recapture");
	if (existsSync(finalDirectory)) throw new Error("Recovery recapture output path already exists");
	assertRecoveryConfig(recoveryConfig);
	assertMetadataPreflight(runWrangler);

	mkdirSync(dirname(finalDirectory), { recursive: true });
	const partialDirectory = `${finalDirectory}.partial-${randomUUID()}`;
	mkdirSync(partialDirectory);
	try {
		const databasePath = join(partialDirectory, "d1.sql");
		let database;
		try {
			runWrangler([
				"d1", "export", "DB", "--remote", "--config", RECOVERY.configPath,
				"--skip-confirmation", "--output", databasePath,
			]);
			database = fileEvidence(databasePath);
		} catch {
			throw new Error("Recovery recapture D1 export failed; partial recapture removed");
		}
		const keys = extractR2Keys(readFileSync(databasePath, "utf8"));
		if (keys.length !== RECOVERY.r2.objectCount) {
			throw new Error("Recovery recapture D1 does not reference exactly 15 objects");
		}
		const objects = [];
		for (const key of keys) {
			const objectPath = keyToPath(partialDirectory, key);
			mkdirSync(dirname(objectPath), { recursive: true });
			try {
				runWrangler([
					"r2", "object", "get", `${RECOVERY.r2.bucketName}/${key}`,
					"--config", RECOVERY.configPath, "--remote", "--file", objectPath,
				]);
			} catch {
				throw new Error("A recovery R2 object could not be captured; partial recapture removed");
			}
			objects.push({ key, ...fileEvidence(objectPath), etag: null });
		}
		writeFileSync(join(partialDirectory, "manifest.json"), canonicalizeRecoveryManifest({
			format: "lumimail-recovery-v1",
			product: "lumimail",
			createdAt: now().toISOString(),
			source: {
				accountId: ORIGINAL.accountId,
				worker: { ...ORIGINAL.worker },
				d1: { ...ORIGINAL.d1 },
				r2: { ...ORIGINAL.r2 },
			},
			application: { ...ORIGINAL.application },
			database: { path: "d1.sql", ...database },
			objects,
		}));
		const verification = verifyRecoveryDirectory(partialDirectory);
		if (verification.problems.length > 0) {
			throw new Error(`Recovery recapture offline verification failed (${verification.problems.length} problems)`);
		}
		renameSync(partialDirectory, finalDirectory);
		return {
			outputDirectory: finalDirectory,
			checkedDatabase: verification.checkedDatabase,
			checkedObjects: verification.checkedObjects,
		};
	} catch (error) {
		rmSync(partialDirectory, { recursive: true, force: true });
		throw error;
	}
}

function wrangler(args) {
	return execFileSync(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), ...args], {
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const outputDirectory = process.argv[2];
	if (!outputDirectory) {
		console.error("Usage: node scripts/recovery-recapture.mjs <new-encrypted-output-directory>");
		process.exitCode = 1;
	} else {
		try {
			const gitClean = String(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })).trim() === "";
			const result = recaptureRecovery({
				outputDirectory,
				gitClean,
				recoveryConfig: JSON.parse(readFileSync(resolve(RECOVERY.configPath), "utf8")),
				runWrangler: wrangler,
			});
			console.log(JSON.stringify(result, null, 2));
		} catch (error) {
			console.error(error instanceof Error ? error.message : "Recovery recapture failed");
			process.exitCode = 1;
		}
	}
}
