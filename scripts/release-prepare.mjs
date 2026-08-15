import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { writeReleaseArchive } from "./release-archive.mjs";
import {
	canonicalizeReleaseManifest,
	createReleaseManifest,
	parseReleaseManifest,
} from "./release-manifest.mjs";

const ARCHIVE_NAME = "lumimail-worker.tar.gz";
const MANIFEST_NAME = "manifest.json";

export class ReleasePreparationError extends Error {
	constructor() {
		super("Release preparation failed. No release bundle was published.");
		this.name = "ReleasePreparationError";
		this.code = "RELEASE_PREPARATION_FAILED";
	}
}

function isWithin(parent, candidate) {
	const path = relative(parent, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function prepareUnsignedReleaseBundle({ sourceDirectory, outputDirectory, metadata }) {
	const source = resolve(sourceDirectory);
	const output = resolve(outputDirectory);
	const parent = dirname(output);
	if (existsSync(output) || !existsSync(parent) || isWithin(source, output)) {
		throw new ReleasePreparationError();
	}
	const partial = `${output}.partial-${randomBytes(8).toString("hex")}`;
	try {
		mkdirSync(partial);
		const archivePath = resolve(partial, ARCHIVE_NAME);
		const archiveReport = writeReleaseArchive(source, archivePath);
		const archiveBytes = readFileSync(archivePath);
		const manifest = createReleaseManifest({
			version: metadata?.version,
			builtAt: metadata?.builtAt,
			commit: metadata?.commit,
			artifactPath: ARCHIVE_NAME,
			artifactBytes: archiveBytes,
			schema: metadata?.schema,
			runtime: metadata?.runtime,
			notes: metadata?.notes,
			...Object.fromEntries(
				Object.keys(metadata ?? {})
					.filter((key) => !["version", "builtAt", "commit", "schema", "runtime", "notes"].includes(key))
					.map((key) => [key, metadata[key]]),
			),
		});
		const manifestPath = resolve(partial, MANIFEST_NAME);
		writeFileSync(manifestPath, canonicalizeReleaseManifest(manifest), { flag: "wx" });

		const verifiedManifest = parseReleaseManifest(readFileSync(manifestPath, "utf8"));
		const verifiedArchive = readFileSync(archivePath);
		const digest = createHash("sha256").update(verifiedArchive).digest("hex");
		if (
			verifiedManifest.artifact.path !== ARCHIVE_NAME ||
			verifiedManifest.artifact.size !== verifiedArchive.length ||
			verifiedManifest.artifact.sha256 !== digest ||
			JSON.stringify(readdirSync(partial).sort()) !== JSON.stringify([ARCHIVE_NAME, MANIFEST_NAME].sort())
		) throw new ReleasePreparationError();

		renameSync(partial, output);
		return Object.freeze({
			outputDirectory: output,
			version: verifiedManifest.version,
			archiveSize: verifiedArchive.length,
			entryCount: archiveReport.entryCount,
		});
	} catch {
		rmSync(partial, { recursive: true, force: true });
		throw new ReleasePreparationError();
	}
}
