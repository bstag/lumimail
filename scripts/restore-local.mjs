/**
 * Restores a `wrangler d1 export` dump into the local Wrangler D1 database, so
 * `npm run dev` runs against a copy of what is deployed.
 *
 * Why not `wrangler d1 execute --local --file`: the dump opens with
 * `PRAGMA defer_foreign_keys=TRUE` because its INSERT statements are not in
 * dependency order. That pragma is scoped to a transaction, and Wrangler executes a
 * file as separate statements, so the deferral does not survive and the load fails
 * on a foreign key. Executing the dump as a single script honours it.
 *
 * This writes directly to the SQLite file Wrangler keeps under `.wrangler/state`,
 * which is the same file Wrangler itself uses for `--local`.
 *
 * The dump contains real message bodies, addresses, and password hashes. Treat the
 * resulting local database as production data.
 *
 * Usage:
 *   node scripts/restore-local.mjs <dump.sql>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const STATE_DIR = resolve(".wrangler/state/v3/d1");

/** Finds the SQLite file Wrangler uses for the local D1 binding. */
export function findLocalDatabase(stateDir = STATE_DIR) {
	if (!existsSync(stateDir)) return null;
	for (const entry of readdirSync(stateDir, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".sqlite")) {
			return join(entry.parentPath, entry.name);
		}
	}
	return null;
}

/**
 * Reports what a restored database contains, so a restore is checked rather than
 * assumed. The orphan count matters more than the row counts: it shows foreign-key
 * relationships survived rather than merely that rows arrived.
 */
export function summarize(database) {
	const tables = database
		.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		.get().n;
	const indexes = database
		.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='index' AND name NOT LIKE 'sqlite_%'")
		.get().n;
	const counts = {};
	for (const name of ["users", "domains", "mailboxes", "messages", "attachments"]) {
		counts[name] = database.prepare(`SELECT COUNT(*) AS n FROM \`${name}\``).get().n;
	}
	const orphanMessages = database
		.prepare(
			"SELECT COUNT(*) AS n FROM messages m LEFT JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.mailbox_id IS NOT NULL AND mb.id IS NULL",
		)
		.get().n;

	return { tables, indexes, counts, orphanMessages };
}

function restoreLocal(dumpPath) {
	const dump = readFileSync(dumpPath, "utf8");

	// Start from an empty database. A dump carries its own d1_migrations rows, which
	// collide with whatever the local database already recorded.
	const existing = findLocalDatabase();
	if (existing) rmSync(existing, { force: true });
	const target = existing ?? join(STATE_DIR, "miniflare-D1DatabaseObject", "restored.sqlite");
	mkdirSync(join(target, ".."), { recursive: true });

	const database = new DatabaseSync(target);
	try {
		// The dump declares foreign keys before the tables they reference - api_keys
		// cites users roughly 180 lines before users is created - so enforcement must
		// be off while loading, or resolution fails on the forward reference. This is
		// also why the dump opens with defer_foreign_keys, which is not sufficient on
		// its own: a missing table is a resolution error, not a constraint violation.
		database.exec("PRAGMA foreign_keys = OFF;");
		database.exec(dump);

		// Re-enable and verify, so a restore is checked rather than trusted.
		database.exec("PRAGMA foreign_keys = ON;");
		const violations = database.prepare("PRAGMA foreign_key_check").all();
		const summary = { ...summarize(database), foreignKeyViolations: violations.length };
		console.log(JSON.stringify(summary, null, 2));
		if (violations.length > 0) {
			console.error("Restored database has foreign key violations:", violations.slice(0, 5));
			process.exitCode = 1;
		}
	} finally {
		database.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const dumpPath = process.argv[2];
	if (!dumpPath) {
		console.error("Usage: node scripts/restore-local.mjs <dump.sql>");
		process.exitCode = 1;
	} else {
		restoreLocal(dumpPath);
	}
}
