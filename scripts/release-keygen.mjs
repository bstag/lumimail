import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const FAILURE_MESSAGE = "Release key generation failed. No key was written.";
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TRUST_FORMAT = "lumimail-release-trust-v1";
const MAX_TRUSTED_KEYS = 32;

export class ReleaseKeygenError extends Error {
	constructor() {
		super(FAILURE_MESSAGE);
		this.name = "ReleaseKeygenError";
		this.code = "RELEASE_KEYGEN_FAILED";
	}
}

function isWithin(parent, candidate) {
	const path = relative(parent, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

/**
 * Reads the committed trust store when one exists. A malformed, foreign, or
 * non-Ed25519 store is refused rather than replaced, so a broken file can never be
 * silently overwritten with a store containing only the new key.
 */
function readTrustStore(trustPath) {
	if (!existsSync(trustPath)) return { format: TRUST_FORMAT, keys: {} };
	const input = JSON.parse(readFileSync(trustPath, "utf8"));
	if (!input || typeof input !== "object" || Array.isArray(input) ||
		JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(["format", "keys"]) ||
		input.format !== TRUST_FORMAT || !input.keys || typeof input.keys !== "object" ||
		Array.isArray(input.keys)) {
		throw new ReleaseKeygenError();
	}
	for (const [keyId, pem] of Object.entries(input.keys)) {
		if (!KEY_ID_PATTERN.test(keyId) || typeof pem !== "string" || pem.length > 4096) {
			throw new ReleaseKeygenError();
		}
		const key = createPublicKey(pem);
		if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new ReleaseKeygenError();
	}
	return input;
}

export function createReleaseSigningKey({ keyId, privateKeyPath, trustPath }) {
	const keyOutput = resolve(privateKeyPath ?? "");
	const trustOutput = resolve(trustPath ?? "");
	const partial = `${trustOutput}.partial-${randomBytes(8).toString("hex")}`;
	try {
		// A private key inside the working tree is one `git add -A` from being committed.
		if (!KEY_ID_PATTERN.test(keyId ?? "") || existsSync(keyOutput) || !existsSync(dirname(keyOutput)) ||
			!existsSync(dirname(trustOutput)) || isWithin(process.cwd(), keyOutput)) {
			throw new ReleaseKeygenError();
		}
		const store = readTrustStore(trustOutput);
		if (Object.hasOwn(store.keys, keyId) || Object.keys(store.keys).length >= MAX_TRUSTED_KEYS) {
			throw new ReleaseKeygenError();
		}

		const pair = generateKeyPairSync("ed25519");
		const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
		const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
		const fingerprint = createHash("sha256")
			.update(pair.publicKey.export({ type: "spki", format: "der" }))
			.digest("hex");

		// Publish the trust store first through a partial rename: a written private key
		// with no matching public entry is recoverable, the reverse is a dead key id.
		const updated = { format: TRUST_FORMAT, keys: { ...store.keys, [keyId]: publicPem } };
		writeFileSync(partial, `${JSON.stringify(updated, null, "\t")}\n`, { flag: "wx" });
		writeFileSync(keyOutput, privatePem, { flag: "wx", mode: 0o600 });
		renameSync(partial, trustOutput);
		return Object.freeze({ keyId, fingerprint, privateKeyPath: keyOutput, trustPath: trustOutput });
	} catch (error) {
		rmSync(partial, { force: true });
		throw error instanceof ReleaseKeygenError ? error : new ReleaseKeygenError();
	}
}

export function runReleaseKeygenCommand(args, {
	stdout = console.log,
	stderr = console.error,
	createKey = createReleaseSigningKey,
} = {}) {
	try {
		if (!Array.isArray(args) || args.length !== 3 || args.some((value) => typeof value !== "string" || !value)) {
			throw new ReleaseKeygenError();
		}
		const report = createKey({ keyId: args[0], privateKeyPath: args[1], trustPath: args[2] });
		stdout(`Created signing key ${report.keyId} (public SHA-256 ${report.fingerprint.slice(0, 16)}).`);
		stdout(`Private key written with owner-only permissions. Back it up; it is never recoverable from the trust store.`);
		return 0;
	} catch {
		stderr(FAILURE_MESSAGE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = runReleaseKeygenCommand(process.argv.slice(2));
}
