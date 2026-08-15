import { createPublicKey } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalizeReleaseManifest, parseReleaseManifest, verifySignedRelease } from "./release-manifest.mjs";

const FAILURE_MESSAGE = "Release verification failed. Release is not trusted.";
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class ReleaseTrustError extends Error {
	constructor() {
		super(FAILURE_MESSAGE);
		this.name = "ReleaseTrustError";
		this.code = "RELEASE_TRUST_FAILED";
	}
}

function parseTrustStore(value) {
	const input = JSON.parse(value);
	if (!input || typeof input !== "object" || Array.isArray(input) ||
		JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(["format", "keys"]) ||
		input.format !== "lumimail-release-trust-v1" || !input.keys || typeof input.keys !== "object" ||
		Array.isArray(input.keys)) throw new ReleaseTrustError();
	const entries = Object.entries(input.keys);
	if (entries.length < 1 || entries.length > 32) throw new ReleaseTrustError();
	const keys = {};
	for (const [keyId, pem] of entries) {
		if (!KEY_ID_PATTERN.test(keyId) || typeof pem !== "string" || pem.length > 4096) throw new ReleaseTrustError();
		const key = createPublicKey(pem);
		if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new ReleaseTrustError();
		keys[keyId] = key;
	}
	return Object.freeze(keys);
}

export function verifyPreparedRelease({ bundleDirectory, signaturePath, trustPath, expectedVersion, expectedSchema }) {
	try {
		const bundle = resolve(bundleDirectory);
		if (JSON.stringify(readdirSync(bundle).sort()) !== JSON.stringify(["lumimail-worker.tar.gz", "manifest.json"].sort())) {
			throw new ReleaseTrustError();
		}
		const manifestBytes = readFileSync(resolve(bundle, "manifest.json"), "utf8");
		const manifest = parseReleaseManifest(manifestBytes);
		if (manifestBytes !== canonicalizeReleaseManifest(manifest)) throw new ReleaseTrustError();
		return verifySignedRelease({
			manifest,
			signature: readFileSync(resolve(signaturePath), "utf8"),
			artifactBytes: readFileSync(resolve(bundle, "lumimail-worker.tar.gz")),
			trustedPublicKeys: parseTrustStore(readFileSync(resolve(trustPath), "utf8")),
			expected: { product: "lumimail", version: expectedVersion, schemaVersion: expectedSchema },
		});
	} catch {
		throw new ReleaseTrustError();
	}
}

export function runReleaseVerificationCommand(args, {
	stdout = console.log,
	stderr = console.error,
	verifyRelease = verifyPreparedRelease,
} = {}) {
	try {
		if (!Array.isArray(args) || args.length !== 5 || args.some((value) => typeof value !== "string" || !value)) {
			throw new ReleaseTrustError();
		}
		const report = verifyRelease({
			bundleDirectory: args[0], signaturePath: args[1], trustPath: args[2],
			expectedVersion: args[3], expectedSchema: args[4],
		});
		stdout(`Verified release ${report.version} ${report.commit.slice(0, 8)} schema ${report.schemaVersion} ` +
			`with ${report.keyId}; ${report.artifactSize} bytes SHA-256 verified`);
		return 0;
	} catch {
		stderr(FAILURE_MESSAGE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = runReleaseVerificationCommand(process.argv.slice(2));
}
