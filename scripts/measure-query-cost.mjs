/**
 * Seeds volume into the local database and measures the cost of the hot queries
 * (F66 / R-17).
 *
 * This measures **database** cost, not end-to-end latency: it runs the SQL the
 * application issues against a local SQLite file. Network, Worker startup, and
 * rendering are deliberately excluded, because the gate concerns D1 query plans and
 * because a developer machine says nothing useful about Cloudflare's network.
 *
 * It writes to the local Wrangler database only. Run `restore-local.mjs` afterwards
 * to get back to a clean copy.
 *
 * Usage:
 *   node scripts/measure-query-cost.mjs [messageCount]
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const STATE_DIR = resolve(".wrangler/state/v3/d1");

function findLocalDatabase() {
	for (const entry of readdirSync(STATE_DIR, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".sqlite")) {
			return join(entry.parentPath, entry.name);
		}
	}
	throw new Error("No local D1 database. Run scripts/restore-local.mjs first.");
}

/** Median of repeated runs; a single timing on a laptop is noise. */
export function medianMs(samples) {
	const sorted = [...samples].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function time(database, sql, params = [], runs = 25) {
	const statement = database.prepare(sql);
	const samples = [];
	for (let i = 0; i < runs; i += 1) {
		const started = performance.now();
		statement.all(...params);
		samples.push(performance.now() - started);
	}
	return medianMs(samples);
}

function seed(database, target) {
	const mailboxes = database.prepare("SELECT id, user_id, organization_id FROM mailboxes").all();
	if (mailboxes.length === 0) throw new Error("No mailboxes; restore a database first.");

	const existing = database.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
	if (existing >= target) return { seeded: 0, total: existing };

	const insert = database.prepare(
		`INSERT INTO messages (id, user_id, organization_id, mailbox_id, direction, from_addr, to_addr,
		 subject, snippet, status, read, starred, thread_id, created_at, attachment_status)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'none')`,
	);

	const now = Math.floor(Date.now() / 1000);
	database.exec("BEGIN");
	let seeded = 0;
	for (let i = existing; i < target; i += 1) {
		const mailbox = mailboxes[i % mailboxes.length];
		insert.run(
			`msg_bulk${i}`,
			mailbox.user_id,
			mailbox.organization_id,
			mailbox.id,
			i % 3 === 0 ? "outbound" : "inbound",
			`sender${i % 500}@external.example`,
			`recipient@${i % 2 ? "lucidkith.com" : "henriksen.dev"}`,
			`Message subject number ${i}`,
			`Body snippet for message ${i} containing searchable words`,
			i % 3 === 0 ? "sent" : "received",
			i % 4 === 0 ? 1 : 0,
			i % 20 === 0 ? 1 : 0,
			`thr_bulk${Math.floor(i / 4)}`,
			// Spread across roughly a year so date ordering has work to do.
			now - (i % 31_536_000),
		);
		seeded += 1;
	}
	database.exec("COMMIT");
	return { seeded, total: target };
}

/**
 * The queries the application actually issues on its hot paths, in the shape it
 * issues them. Names match how they are described in the gate.
 */
export function hotQueries(mailboxId, organizationId, userId) {
	return [
		{
			name: "folder listing (paginated)",
			sql: `SELECT * FROM messages WHERE mailbox_id = ? AND direction = 'inbound'
			      ORDER BY created_at DESC LIMIT 25 OFFSET 0`,
			params: [mailboxId],
		},
		{
			name: "folder listing (deep page)",
			sql: `SELECT * FROM messages WHERE mailbox_id = ? AND direction = 'inbound'
			      ORDER BY created_at DESC LIMIT 25 OFFSET 5000`,
			params: [mailboxId],
		},
		{
			name: "unread counts",
			sql: `SELECT COUNT(*) FROM messages WHERE mailbox_id = ? AND read = 0`,
			params: [mailboxId],
		},
		{
			name: "search by subject/snippet",
			sql: `SELECT * FROM messages WHERE mailbox_id = ?
			      AND (subject LIKE ? OR snippet LIKE ?) ORDER BY created_at DESC LIMIT 25`,
			params: [mailboxId, "%number 4242%", "%number 4242%"],
		},
		{
			name: "thread fetch",
			sql: `SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC`,
			params: ["thr_bulk100"],
		},
		{
			name: "mailbox access subquery",
			sql: `SELECT mailbox_id FROM mailbox_memberships mm
			      JOIN mailboxes mb ON mb.id = mm.mailbox_id
			      WHERE mm.user_id = ? AND mb.organization_id = ?`,
			params: [userId, organizationId],
		},
		{
			name: "session lookup by digest",
			sql: `SELECT * FROM sessions WHERE token_lookup = ? AND expires_at > ? LIMIT 1`,
			params: ["nonexistent", 0],
		},
		{
			name: "inbound routing rules for a domain",
			sql: `SELECT * FROM routing_rules WHERE domain_id = ? ORDER BY priority DESC`,
			params: ["dom_any"],
		},
	];
}

function main(target) {
	const database = new DatabaseSync(findLocalDatabase());
	try {
		const seeded = seed(database, target);
		const mailbox = database.prepare("SELECT id, user_id, organization_id FROM mailboxes LIMIT 1").get();

		const results = hotQueries(mailbox.id, mailbox.organization_id, mailbox.user_id).map((q) => ({
			query: q.name,
			medianMs: Number(time(database, q.sql, q.params).toFixed(3)),
			plan: database
				.prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
				.all(...q.params)
				.map((r) => r.detail)
				.join(" | "),
		}));

		console.log(JSON.stringify({ ...seeded, results }, null, 2));
	} finally {
		database.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(Number(process.argv[2] ?? 25_000));
}
