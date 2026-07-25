/**
 * R2 backup and restore driven by the D1 dump.
 *
 * `wrangler d1 export` captures the database only, so a restore from it alone
 * yields messages whose attachments are missing — and worse, the F63 retention
 * sweep would then delete the surviving objects as unreferenced. This closes that
 * gap.
 *
 * The D1 dump is used as the manifest, because D1 already records every key
 * Lumimail owns. Two consequences worth understanding:
 *
 *  - Only *referenced* objects are captured. An unreferenced object is exactly
 *    what the retention sweep exists to delete, so it does not need backing up.
 *  - Every key in the manifest provably existed when the dump was taken, so the
 *    backup is consistent with the database it accompanies rather than with
 *    whatever the bucket happened to hold later.
 *
 * Scale: this issues one `wrangler r2 object get` per object, so it is linear in
 * object count and suited to the current scale rather than to a large bucket. At
 * volume, use Cloudflare's bucket replication instead.
 *
 * Usage:
 *   node scripts/r2-backup.mjs backup  <dump.sql> <output-dir>
 *   node scripts/r2-backup.mjs restore <backup-dir>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Extracts every R2 key the database references, from a `wrangler d1 export` dump.
 *
 * Reads the INSERT statements rather than connecting to D1, so a backup can be
 * reconstructed from an archived dump alone with no live database.
 */
export function extractR2Keys(dumpSql) {
	const keys = new Set();
	// Keys are opaque ids under two known prefixes; matching the prefixes avoids
	// depending on column order in the INSERT statements.
	for (const match of dumpSql.matchAll(/'((?:attachments|inbound)\/[^']+)'/g)) {
		keys.add(match[1]);
	}
	return [...keys].sort();
}

/** Maps an R2 key to a path on disk, preserving the key as the directory layout. */
export function keyToPath(outputDir, key) {
	return join(outputDir, ...key.split("/"));
}

function wrangler(args) {
	return execFileSync(
		process.execPath,
		[resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
		{ env: { ...process.env, WRANGLER_LOG: "none" }, stdio: ["ignore", "pipe", "pipe"] },
	);
}

function backup(dumpPath, outputDir) {
	const keys = extractR2Keys(readFileSync(dumpPath, "utf8"));
	const manifest = [];
	const missing = [];

	for (const key of keys) {
		const destination = keyToPath(outputDir, key);
		mkdirSync(dirname(destination), { recursive: true });
		try {
			wrangler(["r2", "object", "get", `lumimail-raw-prod/${key}`, "--remote", "--file", destination]);
			const bytes = readFileSync(destination);
			manifest.push({
				key,
				size: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		} catch (error) {
			// A referenced key with no object is a real finding, not a warning to
			// swallow: it means the database points at something that is gone.
			missing.push({ key, error: String(error.message ?? error).slice(0, 200) });
		}
	}

	writeFileSync(
		join(outputDir, "manifest.json"),
		`${JSON.stringify({ referenced: keys.length, captured: manifest.length, missing, objects: manifest }, null, 2)}\n`,
	);

	console.log(JSON.stringify({ referenced: keys.length, captured: manifest.length, missing: missing.length }, null, 2));
	if (missing.length > 0) {
		console.error("Referenced objects were absent from the bucket:", missing);
		process.exitCode = 1;
	}
}

function restore(backupDir) {
	const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));
	let restored = 0;

	for (const entry of manifest.objects) {
		const source = keyToPath(backupDir, entry.key);
		const bytes = readFileSync(source);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		// Verify before writing: restoring corrupted bytes is worse than failing.
		if (sha256 !== entry.sha256) {
			throw new Error(`Checksum mismatch for ${entry.key}; refusing to restore`);
		}
		wrangler(["r2", "object", "put", `lumimail-raw-prod/${entry.key}`, "--remote", "--file", source]);
		restored += 1;
	}

	console.log(JSON.stringify({ restored, expected: manifest.objects.length }, null, 2));
}

/** Verifies a backup directory against its manifest without contacting R2. */
export function verifyBackup(backupDir) {
	const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));
	const problems = [];

	for (const entry of manifest.objects) {
		const path = keyToPath(backupDir, entry.key);
		try {
			const bytes = readFileSync(path);
			if (bytes.length !== entry.size) problems.push(`${entry.key}: size ${bytes.length} != ${entry.size}`);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			if (sha256 !== entry.sha256) problems.push(`${entry.key}: checksum mismatch`);
		} catch {
			problems.push(`${entry.key}: file missing from backup`);
		}
	}

	return { checked: manifest.objects.length, problems };
}

// Only dispatch when run directly. Importing this module — as the tests do — must
// not execute a command or touch process.exitCode.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [command, ...rest] = process.argv.slice(2);
	if (command === "backup") backup(rest[0], rest[1]);
	else if (command === "restore") restore(rest[0]);
	else if (command === "verify") console.log(JSON.stringify(verifyBackup(rest[0]), null, 2));
	else {
		console.error("Usage: r2-backup.mjs backup <dump.sql> <dir> | restore <dir> | verify <dir>");
		process.exitCode = 1;
	}
}
