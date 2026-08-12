import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	parseRecoveryManifest,
	verifyRecoveryDirectory,
} from "./recovery-manifest.mjs";
import { assertSafeRecoveryTarget } from "./recovery-target-guard.mjs";
import { keyToPath } from "./r2-backup.mjs";

function parseJson(label, output) {
	try {
		return JSON.parse(String(output));
	} catch {
		throw new Error(`${label} did not return valid JSON`);
	}
}

function routingZones(output) {
	return [...String(output).matchAll(/│\s*([a-z0-9.-]+)\s*│\s*([a-z0-9-]+)\s*│\s*yes\s*│/gi)].map(
		(match) => ({ domain: match[1], zoneId: match[2] }),
	);
}

function splitSqlStatements(sql) {
	const statements = [];
	let start = 0;
	let quote = null;
	for (let index = 0; index < sql.length; index += 1) {
		const character = sql[index];
		if (quote) {
			if (character === quote) {
				if (sql[index + 1] === quote) index += 1;
				else quote = null;
			}
			continue;
		}
		if (character === "'" || character === '"' || character === "`") {
			quote = character;
			continue;
		}
		if (character === ";") {
			const statement = sql.slice(start, index).trim();
			if (statement) statements.push(statement);
			start = index + 1;
		}
	}
	const remainder = sql.slice(start).trim();
	if (remainder) statements.push(remainder);
	return statements;
}

export function createDataOnlyImport(dumpSql) {
	const inserts = splitSqlStatements(dumpSql).filter(
		(statement) =>
			/^INSERT\s+INTO\b/i.test(statement) &&
			!/^INSERT\s+INTO\s+[`"]?d1_migrations[`"]?\b/i.test(statement),
	);
	return `PRAGMA defer_foreign_keys=TRUE;\n${inserts.map((statement) => `${statement};\n`).join("")}`;
}

export function restoreRecovery({ backupDirectory, target, runWrangler }) {
	const directory = resolve(backupDirectory);
	const verification = verifyRecoveryDirectory(directory);
	if (verification.problems.length > 0) {
		throw new Error(
			`Recovery backup failed offline verification (${verification.problems.length} problems)`,
		);
	}
	const manifest = parseRecoveryManifest(
		readFileSync(join(directory, "manifest.json"), "utf8"),
	);
	const dataOnlySql = createDataOnlyImport(
		readFileSync(join(directory, manifest.database.path), "utf8"),
	);

	const d1Result = parseJson(
		"Recovery D1 inventory",
		runWrangler([
			"d1",
			"execute",
			target.d1.binding,
			"--config",
			target.configPath,
			"--remote",
			"--command",
			"SELECT count(*) AS userTableCount FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';",
			"--json",
		]),
	);
	const userTableCount = d1Result?.[0]?.results?.[0]?.userTableCount;
	const r2Result = parseJson(
		"Recovery R2 inventory",
		runWrangler([
			"r2",
			"bucket",
			"info",
			target.r2.bucketName,
			"--json",
		]),
	);
	const objectCount = Number(r2Result.object_count);

	const zones = routingZones(
		runWrangler(["email", "routing", "list"]),
	);
	const emailRoutes = [];
	for (const zone of zones) {
		const rules = String(
			runWrangler([
				"email",
				"routing",
				"rules",
				"list",
				zone.domain,
				"--zone-id",
				zone.zoneId,
			]),
		);
		if (rules.includes(`worker:${target.workerName}`)) {
			emailRoutes.push({
				enabled: true,
				destinationWorker: target.workerName,
			});
		}
	}

	assertSafeRecoveryTarget({
		production: {
			accountId: manifest.source.accountId,
			workerName: manifest.source.worker.name,
			d1: {
				id: manifest.source.d1.id,
				name: manifest.source.d1.name,
			},
			r2: { bucketName: manifest.source.r2.bucketName },
			queueNames: [],
		},
		target: {
			accountId: target.accountId,
			workerName: target.workerName,
			d1: {
				id: target.d1.id,
				name: target.d1.name,
				userTableCount,
			},
			r2: { bucketName: target.r2.bucketName, objectCount },
			queueNames: [],
			emailRoutes,
		},
	});

	const temporaryDirectory = mkdtempSync(join(tmpdir(), "lumimail-d1-data-"));
	const dataPath = join(temporaryDirectory, "data.sql");
	writeFileSync(dataPath, dataOnlySql);
	let restoredObjects = 0;
	try {
		runWrangler([
			"d1",
			"migrations",
			"apply",
			target.d1.binding,
			"--config",
			target.configPath,
			"--remote",
		]);
		runWrangler([
			"d1",
			"execute",
			target.d1.binding,
			"--config",
			target.configPath,
			"--remote",
			"--file",
			dataPath,
		]);
		for (const entry of manifest.objects) {
			runWrangler([
				"r2",
				"object",
				"put",
				`${target.r2.bucketName}/${entry.key}`,
				"--remote",
				"--file",
				keyToPath(directory, entry.key),
			]);
			restoredObjects += 1;
		}
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}

	return { restoredDatabase: 1, restoredObjects };
}

function wrangler(args) {
	return execFileSync(
		process.execPath,
		[resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
		{ env: process.env, stdio: ["ignore", "pipe", "pipe"] },
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const backupDirectory = process.argv[2];
	if (!backupDirectory) {
		console.error("Usage: node scripts/recovery-restore.mjs <backup-directory>");
		process.exitCode = 1;
	} else {
		try {
			const result = restoreRecovery({
				backupDirectory,
				target: {
					accountId: "caddde404ba5d0324c315dc5cf143696",
					workerName: "lumimail-recovery-20260812",
					configPath: "wrangler.recovery.jsonc",
					d1: {
						binding: "DB",
						id: "d239de97-37f1-4b9a-a664-f787ea60aa97",
						name: "lumimail-staging",
					},
					r2: { bucketName: "lumimail-raw-staging" },
				},
				runWrangler: wrangler,
			});
			console.log(JSON.stringify(result, null, 2));
		} catch (error) {
			console.error(error instanceof Error ? error.message : "Recovery restore failed");
			process.exitCode = 1;
		}
	}
}
