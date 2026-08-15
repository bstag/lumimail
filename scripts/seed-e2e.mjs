/**
 * Seeds a deterministic fixture into the local database for authenticated E2E.
 *
 * The existing Playwright suite mocks every API response, so it exercises the UI
 * against fabricated data and cannot catch an authorization or query defect. These
 * fixtures let tests run against the real backend instead.
 *
 * Everything is prefixed `e2e_` and seeded idempotently, so a run does not disturb
 * a restored production copy sharing the same local database, and repeated runs
 * replace rather than accumulate. Tests assert only on `e2e.test` data, and mailbox
 * membership means the fixture users cannot see anything else regardless.
 *
 * The shape is chosen to make authorization testable:
 *
 *   alpha@e2e.test    owner manages          — ordinary mailbox
 *   shared@e2e.test   owner manages,
 *                     member responds,
 *                     viewer reads           — three people, three capabilities
 *   team@e2e.test     owner manages,
 *                     member responds         — second permitted mailbox for all-scope proof
 *   private@e2e.test  owner manages,
 *                     member has NO row      — the negative case isolation needs
 *
 * Without `private`, "member cannot reach a mailbox they were not granted" is not
 * testable at all. Without the viewer on `shared`, neither is "can read the mailbox
 * but still cannot send from it", which is the capability split rather than the
 * membership one.
 *
 * Usage:
 *   node scripts/seed-e2e.mjs [password]
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";

const STATE_DIR = resolve(".wrangler/state/v3/d1");

export const E2E = {
	password: "e2e-local-password",
	domain: "e2e.test",
	orgId: "e2e_org",
	owner: { id: "e2e_usr_owner", email: "e2e-owner@e2e.test" },
	member: { id: "e2e_usr_member", email: "e2e-member@e2e.test" },
	viewer: { id: "e2e_usr_viewer", email: "e2e-viewer@e2e.test" },
	mailboxes: {
		alpha: { id: "e2e_mbx_alpha", localPart: "alpha" },
		shared: { id: "e2e_mbx_shared", localPart: "shared" },
		team: { id: "e2e_mbx_team", localPart: "team" },
		private: { id: "e2e_mbx_private", localPart: "private" },
	},
};

function findLocalDatabase() {
	for (const entry of readdirSync(STATE_DIR, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".sqlite")) {
			return join(entry.parentPath, entry.name);
		}
	}
	throw new Error("No local D1 database. Run scripts/restore-local.mjs first.");
}

/** Removes every previously seeded row, so re-seeding replaces rather than duplicates. */
function clear(db) {
	// Rows the application created during a test carry generated `msg_` ids, not the
	// `e2e_` prefix, so the id sweep below never reaches them and they accumulate in
	// the local database run after run. They are identifiable by their mailbox.
	db.prepare("DELETE FROM messages WHERE mailbox_id LIKE 'e2e_%'").run();

	// Order matters only for readability; foreign keys cascade from users/org.
	for (const [table, column] of [
		["messages", "id"],
		["mailbox_memberships", "id"],
		["mailboxes", "id"],
		["domains", "id"],
		["organization_members", "id"],
		["users", "id"],
		["organizations", "id"],
	]) {
		db.prepare(`DELETE FROM ${table} WHERE ${column} LIKE 'e2e_%'`).run();
	}
}

function seed(db, password) {
	const now = Math.floor(Date.now() / 1000);
	const hash = bcrypt.hashSync(password, 10);

	db.prepare("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?,?,?,?)")
		.run(E2E.orgId, "E2E Org", now, now);

	// `name` is the fixture's label; `orgRole` is the organization role, which only
	// accepts owner/admin/member. The viewer's restriction is a mailbox role, not an
	// organization one, so at organization level they are an ordinary member.
	for (const [user, name, orgRole] of [
		[E2E.owner, "owner", "owner"],
		[E2E.member, "member", "member"],
		[E2E.viewer, "viewer", "member"],
	]) {
		db.prepare(
			"INSERT INTO users (id, email, password_hash, name, organization_id, created_at) VALUES (?,?,?,?,?,?)",
		).run(user.id, user.email, hash, name, E2E.orgId, now);
		db.prepare(
			"INSERT INTO organization_members (id, organization_id, user_id, role, created_at) VALUES (?,?,?,?,?)",
		).run(`e2e_om_${name}`, E2E.orgId, user.id, orgRole, now);
	}

	db.prepare(
		`INSERT INTO domains (id, user_id, organization_id, hostname, zone_id, status,
		 sending_enabled, routing_enabled, created_at) VALUES (?,?,?,?,?,'active',1,1,?)`,
	).run("e2e_dom", E2E.owner.id, E2E.orgId, E2E.domain, "e2e_zone", now);

	for (const mailbox of Object.values(E2E.mailboxes)) {
		db.prepare(
			`INSERT INTO mailboxes (id, user_id, organization_id, domain_id, local_part, display_name, created_at)
			 VALUES (?,?,?,?,?,?,?)`,
		).run(mailbox.id, E2E.owner.id, E2E.orgId, "e2e_dom", mailbox.localPart, mailbox.localPart, now);
	}

	// The owner manages all three. The member responds on `shared` only — no row at
	// all for `private`, which is what makes the isolation case real.
	const memberships = [
		["e2e_mbm_alpha_owner", E2E.mailboxes.alpha.id, E2E.owner.id, "manager"],
		["e2e_mbm_shared_owner", E2E.mailboxes.shared.id, E2E.owner.id, "manager"],
		["e2e_mbm_team_owner", E2E.mailboxes.team.id, E2E.owner.id, "manager"],
		["e2e_mbm_private_owner", E2E.mailboxes.private.id, E2E.owner.id, "manager"],
		["e2e_mbm_shared_member", E2E.mailboxes.shared.id, E2E.member.id, "responder"],
		["e2e_mbm_team_member", E2E.mailboxes.team.id, E2E.member.id, "responder"],
		// The viewer reads the same mailbox the member responds on. That pairing is
		// what makes "can read but must not send" testable — a user denied the mailbox
		// outright would prove nothing about the capability split.
		["e2e_mbm_shared_viewer", E2E.mailboxes.shared.id, E2E.viewer.id, "viewer"],
	];
	for (const [id, mailboxId, userId, role] of memberships) {
		db.prepare(
			"INSERT INTO mailbox_memberships (id, mailbox_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)",
		).run(id, mailboxId, userId, role, now, now);
	}

	// A few messages per mailbox so listing, counts, and isolation have real rows.
	let n = 0;
	for (const mailbox of Object.values(E2E.mailboxes)) {
		for (let i = 0; i < 3; i += 1) {
			db.prepare(
				`INSERT INTO messages (id, user_id, organization_id, mailbox_id, direction, from_addr,
				 to_addr, subject, snippet, status, read, starred, thread_id, created_at, attachment_status)
				 VALUES (?,?,?,?,'inbound',?,?,?,?,'received',0,0,?,?,'none')`,
			).run(
				// Named after the mailbox rather than a running counter, so a test that
				// asks for a private message says so instead of depending on the order
				// these mailboxes happen to be declared in.
				`e2e_msg_${mailbox.localPart}_${i}`,
				E2E.owner.id,
				E2E.orgId,
				mailbox.id,
				`sender${i}@external.test`,
				`${mailbox.localPart}@${E2E.domain}`,
				`${mailbox.localPart} subject ${i}`,
				`snippet for ${mailbox.localPart} ${i}`,
				`e2e_thr_${mailbox.localPart}`,
				now - n * 60,
			);
			n += 1;
		}
	}

	// Shares a provider thread id with the permitted shared mailbox while living in
	// a mailbox the member cannot access. The inbox aggregate must not count this
	// row when it decorates the member's shared messages with a thread size.
	db.prepare(
		`INSERT INTO messages (id, user_id, organization_id, mailbox_id, direction, from_addr,
		 to_addr, subject, snippet, status, read, starred, thread_id, created_at, attachment_status)
		 VALUES (?,?,?,?,'inbound',?,?,?,?,'received',0,0,?,?,'none')`,
	).run(
		"e2e_msg_private_cross_thread",
		E2E.owner.id,
		E2E.orgId,
		E2E.mailboxes.private.id,
		"cross-thread@external.test",
		`${E2E.mailboxes.private.localPart}@${E2E.domain}`,
		"private cross-thread subject",
		"must not inflate a permitted thread count",
		"e2e_thr_shared",
		now - n * 60,
	);
	n += 1;

	// One draft in the shared mailbox. Drafts are gated on send capability rather
	// than read, so without a draft that actually exists, "the viewer sees no drafts"
	// would pass against an empty list and prove nothing.
	db.prepare(
		`INSERT INTO messages (id, user_id, organization_id, mailbox_id, direction, from_addr,
		 to_addr, subject, snippet, status, read, starred, thread_id, created_at, attachment_status)
		 VALUES (?,?,?,?,'outbound',?,?,?,?,'draft',1,0,?,?,'none')`,
	).run(
		"e2e_msg_shared_draft",
		E2E.owner.id,
		E2E.orgId,
		E2E.mailboxes.shared.id,
		`${E2E.mailboxes.shared.localPart}@${E2E.domain}`,
		"nobody@external.test",
		"shared draft subject",
		"snippet for the shared draft",
		"e2e_thr_shared_draft",
		now,
	);
	n += 1;

	// Real nested-label fixtures (F75/F78). The member-owned label is linked to a
	// shared message the owner may read, so querying it as the owner isolates label
	// ownership from mailbox authorization instead of passing on an unreadable row.
	for (const [id, userId, name, parentId] of [
		["e2e_lbl_owner_parent", E2E.owner.id, "E2E Projects", null],
		["e2e_lbl_owner_child", E2E.owner.id, "E2E Lumimail", "e2e_lbl_owner_parent"],
		["e2e_lbl_member_private", E2E.member.id, "E2E Member Private", null],
	]) {
		db.prepare(
			"INSERT INTO labels (id, user_id, organization_id, name, color, parent_id, created_at) VALUES (?,?,?,?,?,?,?)",
		).run(id, userId, E2E.orgId, name, "#6366f1", parentId, now);
	}
	db.prepare("INSERT INTO message_labels (message_id, label_id) VALUES (?,?)")
		.run("e2e_msg_alpha_0", "e2e_lbl_owner_child");
	db.prepare("INSERT INTO message_labels (message_id, label_id) VALUES (?,?)")
		.run("e2e_msg_shared_1", "e2e_lbl_member_private");

	return { users: 3, mailboxes: 4, messages: n };
}

export function seedE2E(password = E2E.password) {
	const db = new DatabaseSync(findLocalDatabase());
	try {
		db.exec("PRAGMA foreign_keys = ON;");
		clear(db);
		const counts = seed(db, password);
		return counts;
	} finally {
		db.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(seedE2E(process.argv[2] ?? E2E.password), null, 2));
}
