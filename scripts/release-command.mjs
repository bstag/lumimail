import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { deriveReleaseMetadata } from "./release-metadata.mjs";
import { prepareUnsignedReleaseBundle } from "./release-prepare.mjs";

const FAILURE_MESSAGE = "Release preparation failed. No release bundle was published.";

export class ReleaseCommandError extends Error {
	constructor() {
		super(FAILURE_MESSAGE);
		this.name = "ReleaseCommandError";
		this.code = "RELEASE_COMMAND_FAILED";
	}
}

export function parseReleaseCommandArguments(args) {
	if (!Array.isArray(args) || args.length !== 3 || args.some((value) => typeof value !== "string" || !value)) {
		throw new ReleaseCommandError();
	}
	return Object.freeze({
		sourceDirectory: args[0],
		notesPath: args[1],
		outputDirectory: args[2],
	});
}

function parseJsonFile(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

export function prepareReleaseFromCheckout({
	rootDirectory,
	sourceDirectory,
	notesPath,
	outputDirectory,
	runGit = (args) => execFileSync("git", args, { cwd: rootDirectory, encoding: "utf8" }),
	nodeVersion = process.versions.node,
	prepareBundle = prepareUnsignedReleaseBundle,
}) {
	try {
		const root = resolve(rootDirectory);
		const metadata = deriveReleaseMetadata({
			runGit,
			packageManifest: parseJsonFile(resolve(root, "package.json")),
			packageLock: parseJsonFile(resolve(root, "package-lock.json")),
			nodeVersion,
			migrationNames: readdirSync(resolve(root, "drizzle", "migrations"))
				.filter((name) => name.endsWith(".sql")),
			schemaPolicy: parseJsonFile(resolve(root, "release.schema.json")),
			sourceDateEpoch: String(runGit(["show", "-s", "--format=%ct", "HEAD"])).trim(),
			notes: parseJsonFile(resolve(root, notesPath)),
		});
		const resolvedOutput = resolve(root, outputDirectory);
		const bundle = prepareBundle({
			sourceDirectory: resolve(root, sourceDirectory),
			outputDirectory: resolvedOutput,
			metadata,
		});
		return Object.freeze({
			version: metadata.version,
			commit: metadata.commit,
			schema: metadata.schema,
			archiveSize: bundle.archiveSize,
			entryCount: bundle.entryCount,
			outputDirectory: resolvedOutput,
		});
	} catch {
		throw new ReleaseCommandError();
	}
}

export function runReleaseCommand(args, {
	rootDirectory = process.cwd(),
	stdout = console.log,
	stderr = console.error,
	prepare = prepareReleaseFromCheckout,
} = {}) {
	try {
		const parsed = parseReleaseCommandArguments(args);
		const report = prepare({ rootDirectory, ...parsed });
		stdout(
			`Prepared unsigned release ${report.version} ${report.commit.slice(0, 8)} ` +
			`schema ${report.schema.minimum}-${report.schema.maximum}, ` +
			`${report.archiveSize} bytes/${report.entryCount} entries at ${report.outputDirectory}`,
		);
		return 0;
	} catch {
		stderr(FAILURE_MESSAGE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = runReleaseCommand(process.argv.slice(2));
}
