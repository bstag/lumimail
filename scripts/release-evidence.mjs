import { pathToFileURL } from "node:url";

import {
	observationTimestamp,
	publishFailureMessage,
	publishOperationalEvidence,
} from "./operations-evidence.mjs";
import { verifyPreparedRelease } from "./release-verify.mjs";

const RELEASE_FAILURE = "Release verification failed. Release is not trusted.";

export async function runReleaseEvidenceCommand(args, {
	stdout = console.log,
	stderr = console.error,
	verifyRelease = verifyPreparedRelease,
	publishEvidence = publishOperationalEvidence,
	environment = process.env,
	now = () => new Date(),
} = {}) {
	let report;
	try {
		if (!Array.isArray(args) || args.length !== 6 || args.some((value) => typeof value !== "string" || !value)) {
			throw new Error("invalid arguments");
		}
		report = verifyRelease({
			bundleDirectory: args[0],
			signaturePath: args[1],
			trustPath: args[2],
			expectedVersion: args[3],
			expectedSchema: args[4],
		});
		if (!report || report.verified !== true) throw new Error("unverified release");
	} catch {
		stderr(RELEASE_FAILURE);
		return 1;
	}

	try {
		await publishEvidence({
			origin: args[5],
			sessionToken: environment.LUMIMAIL_SESSION_TOKEN,
			evidence: {
				category: "release",
				outcome: "passed",
				passedChecks: 1,
				totalChecks: 1,
				observedAt: observationTimestamp(now()),
			},
		});
		stdout("Verified signed release; operational evidence recorded.");
		return 0;
	} catch (error) {
		stderr(publishFailureMessage(error));
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await runReleaseEvidenceCommand(process.argv.slice(2));
}
