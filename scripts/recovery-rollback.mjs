import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function parseJson(label, output) {
	try {
		return JSON.parse(String(output));
	} catch {
		throw new Error(`Recovery rollback precondition failed: ${label} returned invalid JSON`);
	}
}

function activeVersion(output, expectedVersionId, label) {
	const status = parseJson(label, output);
	if (
		!Array.isArray(status?.versions) ||
		status.versions.length !== 1 ||
		status.versions[0]?.version_id !== expectedVersionId ||
		status.versions[0]?.percentage !== 100
	) {
		throw new Error(
			`Recovery rollback precondition failed: ${label} must have the exact expected version at 100%`,
		);
	}
	return expectedVersionId;
}

function statusArgs(configPath) {
	return ["deployments", "status", "--config", configPath, "--json"];
}

function deployArgs(versionId, configPath, message) {
	return [
		"versions",
		"deploy",
		`${versionId}@100`,
		"--config",
		configPath,
		"--yes",
		"--message",
		message,
	];
}

function assertSmoke(result, label) {
	if (result?.passed !== 6 || result?.total !== 6) {
		throw new Error(`${label} did not pass all six checks`);
	}
	return result.passed;
}

export function runRecoveryRollback({
	configPath,
	origin,
	currentVersionId,
	previousVersionId,
	runWrangler,
	runSmoke,
}) {
	let parsedOrigin;
	try {
		parsedOrigin = new URL(origin);
	} catch {
		throw new Error("Recovery rollback input is invalid");
	}
	if (
		configPath !== "wrangler.recovery.jsonc" ||
		parsedOrigin.protocol !== "https:" ||
		parsedOrigin.pathname !== "/" ||
		parsedOrigin.search ||
		parsedOrigin.hash ||
		!UUID_PATTERN.test(currentVersionId ?? "") ||
		!UUID_PATTERN.test(previousVersionId ?? "") ||
		currentVersionId === previousVersionId ||
		typeof runWrangler !== "function" ||
		typeof runSmoke !== "function"
	) {
		throw new Error("Recovery rollback input is invalid");
	}

	activeVersion(
		runWrangler(statusArgs(configPath)),
		currentVersionId,
		"initial deployment",
	);
	const versions = parseJson(
		"deployable version inventory",
		runWrangler(["versions", "list", "--config", configPath, "--json"]),
	);
	const versionIds = new Set(Array.isArray(versions) ? versions.map((entry) => entry?.id) : []);
	if (!versionIds.has(currentVersionId) || !versionIds.has(previousVersionId)) {
		throw new Error(
			"Recovery rollback precondition failed: both explicit versions must be deployable",
		);
	}

	let rollbackSmokePassed;
	let returnSmokePassed;
	let rollbackError;
	let returnError;
	let returnRequired = false;
	try {
		returnRequired = true;
		runWrangler(
			deployArgs(
				previousVersionId,
				configPath,
				"Lumimail recovery rollback drill",
			),
		);
		activeVersion(
			runWrangler(statusArgs(configPath)),
			previousVersionId,
			"rollback deployment",
		);
		rollbackSmokePassed = assertSmoke(runSmoke(origin), "Recovery rollback smoke");
	} catch (error) {
		rollbackError = error;
	} finally {
		if (returnRequired) {
			try {
				runWrangler(
					deployArgs(
						currentVersionId,
						configPath,
						"Lumimail recovery rollback return",
					),
				);
				activeVersion(
					runWrangler(statusArgs(configPath)),
					currentVersionId,
					"return deployment",
				);
				returnSmokePassed = assertSmoke(runSmoke(origin), "Recovery return smoke");
			} catch (error) {
				returnError = error;
			}
		}
	}

	if (rollbackError && returnError) {
		throw new AggregateError(
			[rollbackError, returnError],
			"Recovery rollback failed and the intended version could not be proven",
		);
	}
	if (returnError) throw returnError;
	if (rollbackError) throw rollbackError;

	return {
		currentVersionId,
		previousVersionId,
		rollbackSmokePassed,
		returnSmokePassed,
		finalVersionId: currentVersionId,
	};
}

function wrangler(args) {
	return execFileSync(
		process.execPath,
		[resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
		{ env: process.env, stdio: ["ignore", "pipe", "pipe"] },
	);
}

function smoke(origin) {
	const output = String(
		execFileSync(process.execPath, [resolve("scripts/smoke.mjs"), origin], {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		}),
	);
	const match = /(?:^|\n)(\d+)\/(\d+) passed against /m.exec(output);
	if (!match) throw new Error("Recovery smoke output was malformed");
	return { passed: Number(match[1]), total: Number(match[2]) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const currentVersionId = process.argv[2];
	const previousVersionId = process.argv[3];
	try {
		const result = runRecoveryRollback({
			configPath: "wrangler.recovery.jsonc",
			origin: "https://lumimail-recovery-20260812.blackstag.workers.dev",
			currentVersionId,
			previousVersionId,
			runWrangler: wrangler,
			runSmoke: smoke,
		});
		console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Recovery rollback failed");
		process.exitCode = 1;
	}
}
