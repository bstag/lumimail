import { createPublicKey, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
	canonicalizeReleaseManifest,
	parseReleaseManifest,
	signReleaseManifest,
	verifySignedRelease,
} from "./release-manifest.mjs";

const FAILURE_MESSAGE = "Release signing failed. No signature was published.";

export class ReleaseSigningError extends Error {
	constructor() {
		super(FAILURE_MESSAGE);
		this.name = "ReleaseSigningError";
		this.code = "RELEASE_SIGNING_FAILED";
	}
}

function isWithin(parent, candidate) {
	const path = relative(parent, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function signPreparedRelease({ bundleDirectory, keyId, privateKeyInput, signaturePath }) {
	const bundle = resolve(bundleDirectory);
	const output = resolve(signaturePath);
	const partial = `${output}.partial-${randomBytes(8).toString("hex")}`;
	try {
		if (existsSync(output) || !existsSync(dirname(output)) || isWithin(bundle, output) ||
			JSON.stringify(readdirSync(bundle).sort()) !== JSON.stringify(["lumimail-worker.tar.gz", "manifest.json"].sort())) {
			throw new ReleaseSigningError();
		}
		const manifestBytes = readFileSync(resolve(bundle, "manifest.json"), "utf8");
		const manifest = parseReleaseManifest(manifestBytes);
		if (manifestBytes !== canonicalizeReleaseManifest(manifest)) throw new ReleaseSigningError();
		const artifactBytes = readFileSync(resolve(bundle, "lumimail-worker.tar.gz"));
		const signature = signReleaseManifest(manifest, privateKeyInput, keyId);
		const publicKey = createPublicKey(privateKeyInput);
		verifySignedRelease({
			manifest,
			signature,
			artifactBytes,
			trustedPublicKeys: { [keyId]: publicKey },
			expected: { product: "lumimail", version: manifest.version, schemaVersion: manifest.schema.current },
		});
		writeFileSync(partial, `${JSON.stringify(signature)}\n`, { flag: "wx", mode: 0o600 });
		renameSync(partial, output);
		return Object.freeze({ version: manifest.version, commit: manifest.commit, keyId, signaturePath: output });
	} catch {
		rmSync(partial, { force: true });
		throw new ReleaseSigningError();
	}
}

export function runReleaseSigningCommand(args, {
	readStdin = () => readFileSync(0),
	stdout = console.log,
	stderr = console.error,
	signRelease = signPreparedRelease,
} = {}) {
	try {
		if (!Array.isArray(args) || args.length !== 3 || args.some((value) => typeof value !== "string" || !value)) {
			throw new ReleaseSigningError();
		}
		const report = signRelease({
			bundleDirectory: args[0], keyId: args[1], privateKeyInput: readStdin(), signaturePath: args[2],
		});
		stdout(`Signed release ${report.version} ${report.commit.slice(0, 8)} with ${report.keyId} at ${report.signaturePath}`);
		return 0;
	} catch {
		stderr(FAILURE_MESSAGE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = runReleaseSigningCommand(process.argv.slice(2));
}
