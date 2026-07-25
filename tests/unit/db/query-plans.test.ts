import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());
const wranglerCli = resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js");

let persistenceDirectory: string;
let database: DatabaseSync;

function findSqliteDatabase(directory: string): string {
	for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".sqlite")) {
			return resolve(entry.parentPath, entry.name);
		}
	}
	throw new Error(`Wrangler did not create a local SQLite database under ${directory}`);
}

/** The plan text SQLite produces for a query, one line per step. */
function plan(sql: string): string {
	const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as unknown as {
		detail: string;
	}[];
	return rows.map((row) => row.detail).join("\n");
}

beforeAll(() => {
	persistenceDirectory = mkdtempSync(join(tmpdir(), "lumimail-query-plans-"));
	execFileSync(
		process.execPath,
		[wranglerCli, "d1", "migrations", "apply", "DB", "--local", "--persist-to", persistenceDirectory],
		{ cwd: projectRoot, env: { ...process.env, WRANGLER_LOG: "none" }, stdio: "pipe" },
	);
	database = new DatabaseSync(findSqliteDatabase(persistenceDirectory), { readOnly: true });
}, 120_000);

afterAll(() => {
	database?.close();
	if (persistenceDirectory) rmSync(persistenceDirectory, { recursive: true, force: true });
});

/**
 * Plans are asserted rather than timings: an index name in a plan is a stable
 * contract across machines, a millisecond count is not. Each case names the path
 * that would regress and why it matters (F66).
 */
describe("hot query plans", () => {
	it("resolves a session by indexed digest rather than scanning", () => {
		const detail = plan(
			"SELECT * FROM sessions WHERE token_lookup = 'x' AND expires_at > 0 LIMIT 1",
		);

		expect(detail).toContain("sessions_token_lookup_idx");
		expect(detail).not.toContain("SCAN sessions");
	});

	it("finds a domain's routing rules by index", () => {
		// Inbound routing runs this per message, and since F62 twice per message.
		const detail = plan(
			"SELECT * FROM routing_rules WHERE domain_id = 'd' ORDER BY priority DESC",
		);

		expect(detail).toContain("routing_rules_domain_idx");
		expect(detail).not.toContain("SCAN routing_rules");
	});

	it("finds a user's message filters by index", () => {
		const detail = plan("SELECT * FROM message_filters WHERE user_id = 'u'");

		expect(detail).toContain("message_filters_user_idx");
		expect(detail).not.toContain("SCAN message_filters");
	});

	it("finds a message's attachments by index", () => {
		const detail = plan("SELECT * FROM attachments WHERE message_id = 'm'");

		expect(detail).toContain("attachments_message_idx");
		expect(detail).not.toContain("SCAN attachments");
	});

	it("finds a user's api keys by index", () => {
		const detail = plan("SELECT * FROM api_keys WHERE user_id = 'u'");

		expect(detail).toContain("api_keys_user_idx");
		expect(detail).not.toContain("SCAN api_keys");
	});

	it("fetches a conversation by index rather than scanning", () => {
		// Found by measuring at 25,000 messages: this scanned the table and sorted
		// into a temporary B-tree, costing 4.7ms where an index costs 0.01ms. The
		// earlier audit missed it because `messages` had indexes — just none serving
		// this shape.
		const detail = plan(
			"SELECT * FROM messages WHERE thread_id = 't' ORDER BY created_at ASC",
		);

		expect(detail).toContain("messages_thread_created_idx");
		expect(detail).not.toContain("SCAN messages");
		expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
	});

	it("lists a mailbox folder without sorting the table", () => {
		const detail = plan(
			"SELECT * FROM messages WHERE mailbox_id = 'mb' ORDER BY created_at DESC LIMIT 25",
		);

		// The composite index supplies the ordering, so no temporary B-tree is built.
		expect(detail).toContain("messages_mailbox_created_idx");
		expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
	});

	it("resolves mailbox membership by index in both directions", () => {
		// Access checks look up by user, administration by mailbox. Several indexes
		// lead on mailbox_id, so the contract is that an index is used rather than
		// which one the planner picks.
		expect(plan("SELECT * FROM mailbox_memberships WHERE user_id = 'u'"))
			.toContain("mailbox_memberships_user_mailbox_idx");

		const byMailbox = plan("SELECT * FROM mailbox_memberships WHERE mailbox_id = 'mb'");
		expect(byMailbox).toMatch(/SEARCH mailbox_memberships USING (COVERING )?INDEX/);
		expect(byMailbox).not.toContain("SCAN mailbox_memberships");
	});

	it("resolves an inbound address by indexed domain and local part", () => {
		expect(plan("SELECT * FROM domains WHERE hostname = 'example.com'"))
			.toContain("domains_hostname_idx");
		expect(plan("SELECT * FROM mailboxes WHERE domain_id = 'd' AND local_part = 'a'"))
			.toContain("mailboxes_address_idx");
		expect(plan("SELECT * FROM aliases WHERE domain_id = 'd' AND local_part = 'a'"))
			.toContain("aliases_address_idx");
	});

	it("finds a mailbox responder and its reply window by index", () => {
		expect(plan("SELECT * FROM vacation_responders WHERE mailbox_id = 'mb'"))
			.toContain("vacation_responders_mailbox_id_unique");
		expect(plan(
			"SELECT * FROM vacation_reply_log WHERE mailbox_id = 'mb' AND sender_address = 's'",
		)).toContain("vacation_reply_log_mailbox_sender_idx");
	});
});
