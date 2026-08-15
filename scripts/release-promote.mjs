import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { SMOKE_CHECK_COUNT } from "./operations-evidence.mjs";
import { writeReleaseArchive } from "./release-archive.mjs";
import { verifyPreparedRelease } from "./release-verify.mjs";

const FAILURE_MESSAGE = "Release promotion failed. Production traffic is unchanged.";

export class ReleasePromotionError extends Error {
	constructor() {
		super(FAILURE_MESSAGE);
		this.name = "ReleasePromotionError";
		this.code = "RELEASE_PROMOTION_FAILED";
	}
}

const VERSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

/**
 * `wrangler versions upload` has no JSON output, so the version identity is read
 * from its exact labelled lines. An absent or ambiguous label refuses promotion
 * rather than guessing which version would receive traffic.
 */
function parseUploadedVersion(output) {
	const text = String(output).replaceAll(/\x1b\[[0-9;]*m/g, "");
	const ids = [...text.matchAll(/^\s*Worker Version ID:\s*(\S+)\s*$/gm)].map((match) => match[1]);
	const urls = [...text.matchAll(/^\s*Version Preview URL:\s*(\S+)\s*$/gm)].map((match) => match[1]);
	if (ids.length !== 1 || urls.length !== 1 || !VERSION_ID_PATTERN.test(ids[0])) return null;
	let origin;
	try {
		const url = new URL(urls[0]);
		if (url.protocol !== "https:" || url.username || url.password) return null;
		origin = url.origin;
	} catch {
		return null;
	}
	return { versionId: ids[0], origin };
}

/**
 * Promotion is the only place a signature becomes meaningful. Verification proves the
 * bundle is trusted; the checkout and digest bindings prove the trusted bundle is the
 * tree about to receive traffic. Upload, smoke, and promotion stay separate so any
 * failure leaves production on its current version.
 */
export function promoteVerifiedRelease({
	bundleDirectory,
	signaturePath,
	trustPath,
	sourceDirectory,
	expectedVersion,
	expectedSchema,
	verifyRelease = verifyPreparedRelease,
	readCheckout = readGitCheckout,
	archiveSource = archiveBuildTree,
	runWrangler = wranglerText,
	runSmoke = smoke,
}) {
	let release;
	try {
		release = verifyRelease({
			bundleDirectory, signaturePath, trustPath, expectedVersion, expectedSchema,
		});
		// Require the fields the bindings below compare. Without this an absent digest
		// would compare undefined to undefined and silently satisfy the gate.
		if (!release || typeof release.commit !== "string" || !DIGEST_PATTERN.test(release.artifactSha256 ?? "") ||
			!Number.isInteger(release.artifactSize)) throw new ReleasePromotionError();
	} catch {
		throw new ReleasePromotionError();
	}

	try {
		const checkout = readCheckout();
		if (checkout?.clean !== true || checkout.commit !== release.commit) throw new ReleasePromotionError();

		const rebuilt = archiveSource(sourceDirectory);
		if (rebuilt?.size !== release.artifactSize || rebuilt?.sha256 !== release.artifactSha256) {
			throw new ReleasePromotionError();
		}
	} catch {
		throw new ReleasePromotionError();
	}

	let uploaded;
	try {
		uploaded = parseUploadedVersion(runWrangler(["versions", "upload", "--config", "wrangler.jsonc"]));
		if (!uploaded) throw new ReleasePromotionError();
	} catch {
		throw new ReleasePromotionError();
	}

	// From here a version exists but carries no traffic. Every later failure is an
	// accepted outcome: the operator can inspect or discard it without a rollback.
	let smokePassed = 0;
	try {
		const result = runSmoke(uploaded.origin);
		smokePassed = Number(result?.passed ?? 0);
		if (result?.total !== SMOKE_CHECK_COUNT || smokePassed !== SMOKE_CHECK_COUNT) {
			throw new ReleasePromotionError();
		}
		runWrangler([
			"versions", "deploy", "--version-id", uploaded.versionId, "--percentage", "100",
			"--config", "wrangler.jsonc", "--yes",
		]);
	} catch {
		throw new ReleasePromotionError();
	}

	return Object.freeze({
		version: release.version,
		schemaVersion: release.schemaVersion,
		keyId: release.keyId,
		commit: release.commit,
		versionId: uploaded.versionId,
		artifactSize: release.artifactSize,
		smokePassed,
		promoted: true,
	});
}

function git(args) {
	return String(execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] })).trim();
}

function readGitCheckout() {
	return { commit: git(["rev-parse", "HEAD"]), clean: git(["status", "--porcelain"]) === "" };
}

/**
 * Re-archives the build tree deterministically and reports the result's identity.
 * The temporary archive is always removed; only its size and digest are returned.
 */
function archiveBuildTree(sourceDirectory) {
	const output = join(tmpdir(), `lumimail-promote-${process.pid}-${Date.now()}.tar.gz`);
	try {
		writeReleaseArchive(resolve(sourceDirectory), output);
		const bytes = readFileSync(output);
		return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
	} finally {
		rmSync(output, { force: true });
	}
}

function wranglerText(args) {
	return String(execFileSync(
		process.execPath,
		[resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
		{ env: process.env, stdio: ["ignore", "pipe", "pipe"] },
	));
}

function smoke(origin) {
	const output = String(execFileSync(process.execPath, [resolve("scripts/smoke.mjs"), origin], {
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	}));
	const match = /(?:^|\n)(\d+)\/(\d+) passed against /m.exec(output);
	if (!match) return { passed: 0, total: 0 };
	return { passed: Number(match[1]), total: Number(match[2]) };
}

export function runReleasePromotionCommand(args, {
	stdout = console.log,
	stderr = console.error,
	promote = promoteVerifiedRelease,
} = {}) {
	try {
		if (!Array.isArray(args) || args.length !== 6 || args.some((value) => typeof value !== "string" || !value)) {
			throw new ReleasePromotionError();
		}
		const report = promote({
			bundleDirectory: args[0], signaturePath: args[1], trustPath: args[2],
			sourceDirectory: args[3], expectedVersion: args[4], expectedSchema: args[5],
		});
		stdout(`Promoted release ${report.version} schema ${report.schemaVersion} signed by ${report.keyId}`);
		stdout(`Version ${report.versionId} passed ${report.smokePassed}/${SMOKE_CHECK_COUNT} public checks before promotion`);
		return 0;
	} catch {
		stderr(FAILURE_MESSAGE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = runReleasePromotionCommand(process.argv.slice(2));
}
