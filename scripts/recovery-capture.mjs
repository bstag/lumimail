import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { extractR2Keys, keyToPath } from "./r2-backup.mjs";
import {
	canonicalizeRecoveryManifest,
	verifyRecoveryDirectory,
} from "./recovery-manifest.mjs";

function parseProviderJson(label, value) {
	try {
		return JSON.parse(String(value));
	} catch {
		throw new Error(`${label} did not return valid JSON`);
	}
}

function fileEvidence(path) {
	const bytes = readFileSync(path);
	return {
		size: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

function latestSchemaVersion(migrationNames) {
	const versions = migrationNames
		.map((name) => /^(\d{4})_/.exec(name)?.[1])
		.filter(Boolean)
		.sort();
	const version = versions.at(-1);
	if (!version) throw new Error("No numbered D1 migration was found");
	return version;
}

function deployedBinding(version, type, name) {
	return version?.resources?.bindings?.find(
		(binding) => binding?.type === type && binding?.name === name,
	);
}

export function captureRecovery({
	outputDirectory,
	config,
	gitCommit,
	gitClean,
	migrationNames,
	now = () => new Date(),
	runWrangler,
}) {
	const finalDirectory = resolve(outputDirectory);
	if (!gitClean) {
		throw new Error("Git worktree must be clean before production capture");
	}
	if (existsSync(finalDirectory)) {
		throw new Error("Recovery output path already exists");
	}

	const deployment = parseProviderJson(
		"Worker deployment status",
		runWrangler([
			"deployments",
			"status",
			"--name",
			config.workerName,
			"--json",
		]),
	);
	if (
		!Array.isArray(deployment.versions) ||
		deployment.versions.length !== 1 ||
		deployment.versions[0]?.percentage !== 100 ||
		typeof deployment.versions[0]?.version_id !== "string"
	) {
		throw new Error(
			"Production must have exactly one Worker version at 100% traffic",
		);
	}
	const workerVersion = deployment.versions[0].version_id;
	const version = parseProviderJson(
		"Worker version detail",
		runWrangler([
			"versions",
			"view",
			workerVersion,
			"--name",
			config.workerName,
			"--json",
		]),
	);
	if (version.id !== workerVersion) {
		throw new Error("Active Worker version detail does not match deployment");
	}
	if (
		version?.resources?.script_runtime?.compatibility_date !==
		config.compatibilityDate
	) {
		throw new Error(
			"Active Worker compatibility date does not match production configuration",
		);
	}
	const d1Binding = deployedBinding(version, "d1", config.d1.binding);
	if (d1Binding?.database_id?.toLowerCase() !== config.d1.id.toLowerCase()) {
		throw new Error(
			"Active Worker D1 binding does not match production configuration",
		);
	}
	const r2Binding = deployedBinding(version, "r2_bucket", config.r2.binding);
	if (r2Binding?.bucket_name !== config.r2.bucketName) {
		throw new Error(
			"Active Worker R2 binding does not match production configuration",
		);
	}
	const scriptEtag = version?.resources?.script?.etag;
	if (typeof scriptEtag !== "string") {
		throw new Error("Active Worker version has no script ETag");
	}

	mkdirSync(dirname(finalDirectory), { recursive: true });
	const partialDirectory = `${finalDirectory}.partial-${randomUUID()}`;
	mkdirSync(partialDirectory);

	try {
		const bookmarkResult = parseProviderJson(
			"D1 Time Travel",
			runWrangler([
				"d1",
				"time-travel",
				"info",
				config.d1.binding,
				"--json",
			]),
		);
		if (typeof bookmarkResult.bookmark !== "string" || !bookmarkResult.bookmark) {
			throw new Error("D1 Time Travel did not return a bookmark");
		}

		const databasePath = join(partialDirectory, "d1.sql");
		runWrangler([
			"d1",
			"export",
			config.d1.binding,
			"--remote",
			"--skip-confirmation",
			"--output",
			databasePath,
		]);
		const database = fileEvidence(databasePath);
		const keys = extractR2Keys(readFileSync(databasePath, "utf8"));
		const objects = [];

		for (const key of keys) {
			const objectPath = keyToPath(partialDirectory, key);
			mkdirSync(dirname(objectPath), { recursive: true });
			try {
				runWrangler([
					"r2",
					"object",
					"get",
					`${config.r2.bucketName}/${key}`,
					"--remote",
					"--file",
					objectPath,
				]);
			} catch {
				throw new Error(
					"A D1-referenced R2 object could not be captured; partial backup removed",
				);
			}
			objects.push({ key, ...fileEvidence(objectPath), etag: null });
		}

		const manifest = {
			format: "lumimail-recovery-v1",
			product: "lumimail",
			createdAt: now().toISOString(),
			source: {
				accountId: config.accountId,
				worker: {
					name: config.workerName,
					versionId: workerVersion,
					scriptEtag,
					compatibilityDate: config.compatibilityDate,
				},
				d1: {
					id: config.d1.id,
					name: config.d1.name,
					bookmark: bookmarkResult.bookmark,
				},
				r2: { bucketName: config.r2.bucketName },
			},
			application: {
				gitCommit,
				schemaVersion: latestSchemaVersion(migrationNames),
			},
			database: { path: "d1.sql", ...database },
			objects,
		};
		writeFileSync(
			join(partialDirectory, "manifest.json"),
			canonicalizeRecoveryManifest(manifest),
		);
		const verification = verifyRecoveryDirectory(partialDirectory);
		if (verification.problems.length > 0) {
			throw new Error(
				`Offline recovery verification failed (${verification.problems.length} problems)`,
			);
		}
		renameSync(partialDirectory, finalDirectory);
		return {
			outputDirectory: finalDirectory,
			workerVersion,
			checkedDatabase: verification.checkedDatabase,
			checkedObjects: verification.checkedObjects,
		};
	} catch (error) {
		rmSync(partialDirectory, { recursive: true, force: true });
		throw error;
	}
}

function parseJsonc(text) {
	let stripped = "";
	let inString = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (inString) {
			stripped += character;
			if (character === "\\") {
				stripped += text[index + 1] ?? "";
				index += 1;
			} else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') {
			inString = true;
			stripped += character;
		} else if (character === "/" && text[index + 1] === "/") {
			while (index < text.length && text[index] !== "\n") index += 1;
			stripped += "\n";
		} else if (character === "/" && text[index + 1] === "*") {
			index += 2;
			while (
				index < text.length &&
				!(text[index] === "*" && text[index + 1] === "/")
			) {
				index += 1;
			}
			index += 1;
		} else stripped += character;
	}
	return JSON.parse(stripped.replace(/,\s*([}\]])/g, "$1"));
}

function productionConfig() {
	const config = parseJsonc(readFileSync(resolve("wrangler.jsonc"), "utf8"));
	const d1 = config.d1_databases?.find((entry) => entry.binding === "DB");
	const r2 = config.r2_buckets?.find((entry) => entry.binding === "BUCKET");
	if (!d1 || !r2) throw new Error("Production DB and BUCKET bindings are required");
	return {
		accountId: config.vars?.CF_ACCOUNT_ID,
		workerName: config.name,
		compatibilityDate: config.compatibility_date,
		d1: {
			binding: d1.binding,
			id: d1.database_id,
			name: d1.database_name,
		},
		r2: { binding: r2.binding, bucketName: r2.bucket_name },
	};
}

function wrangler(args) {
	return execFileSync(
		process.execPath,
		[resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
		{
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const outputDirectory = process.argv[2];
	if (!outputDirectory) {
		console.error("Usage: node scripts/recovery-capture.mjs <new-output-directory>");
		process.exitCode = 1;
	} else {
		try {
			const gitCommit = String(
				execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }),
			).trim();
			const gitClean =
				String(
					execFileSync("git", ["status", "--porcelain"], {
						encoding: "utf8",
					}),
				).trim() === "";
			const result = captureRecovery({
				outputDirectory,
				config: productionConfig(),
				gitCommit,
				gitClean,
				migrationNames: readdirSync(resolve("drizzle/migrations")),
				runWrangler: wrangler,
			});
			console.log(JSON.stringify(result, null, 2));
		} catch (error) {
			console.error(error instanceof Error ? error.message : "Recovery capture failed");
			process.exitCode = 1;
		}
	}
}
