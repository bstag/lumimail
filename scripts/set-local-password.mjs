/**
 * Sets one password across every user in the **local** Wrangler database, so a
 * restored copy can be logged into for development and testing.
 *
 * This exists because a restore carries production password hashes, which nobody
 * developing against the copy knows or should need. It refuses to run against
 * anything but the local Wrangler state — there is no remote mode, deliberately.
 *
 * Usage:
 *   node scripts/set-local-password.mjs <password>
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";

const STATE_DIR = resolve(".wrangler/state/v3/d1");

export function findLocalDatabase(stateDir = STATE_DIR) {
	for (const entry of readdirSync(stateDir, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".sqlite")) {
			return join(entry.parentPath, entry.name);
		}
	}
	throw new Error(`No local D1 database under ${stateDir}. Restore one first.`);
}

function main(password) {
	const database = new DatabaseSync(findLocalDatabase());
	try {
		// Same library and cost as the application, so the hash actually verifies.
		const hash = bcrypt.hashSync(password, 10);
		const users = database.prepare("SELECT id, email FROM users").all();
		for (const user of users) {
			database.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
		}

		// Session rows carry digests of tokens issued elsewhere; they cannot
		// authenticate here and would only be confusing state.
		database.prepare("DELETE FROM sessions").run();

		console.log(JSON.stringify({ users: users.map((u) => u.email), sessionsCleared: true }, null, 2));
	} finally {
		database.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const password = process.argv[2];
	if (!password) {
		console.error("Usage: node scripts/set-local-password.mjs <password>");
		process.exitCode = 1;
	} else {
		main(password);
	}
}
