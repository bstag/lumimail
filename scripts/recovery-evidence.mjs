import { pathToFileURL } from "node:url";

import {
	observationTimestamp,
	publishFailureMessage,
	publishOperationalEvidence,
} from "./operations-evidence.mjs";
import { verifyRecoveryDirectory } from "./recovery-manifest.mjs";

const VERIFY_FAILURE = "Recovery archive verification failed. Evidence was not recorded.";
const MAX_TOTAL_CHECKS = 1000;

function derive(result) {
	if (!Number.isInteger(result?.checkedDatabase) || !Number.isInteger(result?.checkedObjects) ||
		!Array.isArray(result?.problems)) {
		throw new Error("invalid verification result");
	}
	const totalChecks = result.checkedDatabase + result.checkedObjects;
	if (totalChecks < 1 || totalChecks > MAX_TOTAL_CHECKS) throw new Error("artifact count outside ledger bounds");

	// Verification can report several problems for one artifact (size and checksum),
	// so failures are counted per distinct artifact rather than per problem line.
	const failedArtifacts = new Set(result.problems.map((problem) => String(problem).split(":")[0]));
	const failed = result.problems.length === 0
		? 0
		: Math.min(Math.max(failedArtifacts.size, 1), totalChecks);
	return {
		category: "recovery",
		outcome: failed === 0 ? "passed" : "failed",
		passedChecks: totalChecks - failed,
		totalChecks,
	};
}

export async function runRecoveryEvidenceCommand(args, {
	stdout = console.log,
	stderr = console.error,
	verifyArchive = verifyRecoveryDirectory,
	publishEvidence = publishOperationalEvidence,
	environment = process.env,
	now = () => new Date(),
} = {}) {
	let evidence;
	try {
		if (!Array.isArray(args) || args.length !== 2 || args.some((value) => typeof value !== "string" || !value)) {
			throw new Error("invalid arguments");
		}
		evidence = derive(verifyArchive(args[0]));
	} catch {
		stderr(VERIFY_FAILURE);
		return 1;
	}

	try {
		await publishEvidence({
			origin: args[1],
			sessionToken: environment.LUMIMAIL_SESSION_TOKEN,
			evidence: { ...evidence, observedAt: observationTimestamp(now()) },
		});
	} catch (error) {
		stderr(publishFailureMessage(error));
		return 1;
	}

	if (evidence.outcome === "failed") {
		stderr(`Recovery archive is incomplete: ${evidence.passedChecks}/${evidence.totalChecks} artifacts verified. Evidence recorded.`);
		return 1;
	}
	stdout(`Verified ${evidence.totalChecks} recovery artifacts; operational evidence recorded.`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await runRecoveryEvidenceCommand(process.argv.slice(2));
}
