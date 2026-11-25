import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { messageListSortTime } from "@/lib/messages/list-conditions";
import { createMigratedDb } from "../helpers/sqlite";

let database: DatabaseSync;

/** The plan text SQLite produces for a query, one line per step. */
function plan(sql: string): string {
	const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as unknown as {
		detail: string;
	}[];
	return rows.map((row) => row.detail).join("\n");
}

beforeAll(() => {
	database = createMigratedDb().sqlite;
});

afterAll(() => database?.close());

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

	it("uses the index for the production wake-time order and ID tie breaker", () => {
		const sort = new SQLiteSyncDialect().sqlToQuery(messageListSortTime).sql;
		const detail = plan(`SELECT * FROM messages WHERE mailbox_id = 'mb' AND status = 'received'
			ORDER BY ${sort} DESC, id DESC LIMIT 25`);
		expect(detail).toContain("messages_mailbox_list_order_idx");
		expect(detail).not.toContain("USE TEMP B-TREE FOR ORDER BY");
		const later = plan(`SELECT * FROM messages WHERE mailbox_id = 'mb' AND status = 'received'
			AND ${sort} <= 500 AND (${sort}, id) < (500, 'msg_cursor') ORDER BY ${sort} DESC, id DESC LIMIT 25`);
		expect(later).toContain("messages_mailbox_list_order_idx (mailbox_id=? AND <expr><?)");
		expect(later).not.toContain("USE TEMP B-TREE FOR ORDER BY");
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
