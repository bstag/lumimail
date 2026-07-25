/**
 * Seeds synthetic accounts into the staging database (F67).
 *
 * Staging holds no production data by decision: nothing here copies real message
 * bodies or password hashes out of production. Every account is created fresh so
 * tests own their fixtures and can be destructive.
 *
 * This writes users, an organization, and mailbox memberships directly, because
 * registration through the API would attach Cloudflare provisioning to each domain
 * and this seeds the state those flows assume already exists.
 *
 * Usage:
 *   node scripts/seed-staging.mjs --domain staging.example --password '<password>'
 *
 * The password is hashed with the same cost the application uses. Supply it on the
 * command line for a throwaway environment only; never reuse a production password.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Mirrors `newId` so seeded ids are recognisable as seed data. */
export function seedId(prefix, label) {
	return `${prefix}_seed${label}`;
}

/**
 * The accounts staging needs to exercise the multi-user and shared-mailbox paths.
 *
 * Two mailboxes on different domains let a test send between domains; the shared
 * mailbox with two members is what F47's isolation and F65's per-mailbox responder
 * scoping actually need in order to be tested at all.
 */
export function seedPlan(domainA, domainB) {
	return {
		organization: { id: seedId("org", "1"), name: "Staging Org" },
		users: [
			{ id: seedId("usr", "owner"), email: `owner@${domainA}`, name: "Owner", role: "owner" },
			{ id: seedId("usr", "member"), email: `member@${domainA}`, name: "Member", role: "member" },
		],
		domains: [
			{ id: seedId("dom", "a"), hostname: domainA },
			{ id: seedId("dom", "b"), hostname: domainB },
		],
		mailboxes: [
			{ id: seedId("mbx", "a"), domain: "a", localPart: "alpha", owner: "owner" },
			{ id: seedId("mbx", "b"), domain: "b", localPart: "beta", owner: "owner" },
			{ id: seedId("mbx", "shared"), domain: "a", localPart: "shared", owner: "owner" },
		],
		// The shared mailbox is the point: one mailbox, two people, different roles.
		memberships: [
			{ mailbox: "a", user: "owner", role: "manager" },
			{ mailbox: "b", user: "owner", role: "manager" },
			{ mailbox: "shared", user: "owner", role: "manager" },
			{ mailbox: "shared", user: "member", role: "responder" },
		],
	};
}

function sqlString(value) {
	return value === null ? "NULL" : `'${String(value).replace(/'/g, "''")}'`;
}

/** Renders the plan as idempotent SQL: re-seeding replaces rather than duplicates. */
export function renderSeedSql(plan, passwordHash, now) {
	const lines = [];
	const org = plan.organization;
	const byUser = Object.fromEntries(plan.users.map((u) => [u.role === "owner" ? "owner" : "member", u]));
	const byDomain = Object.fromEntries(plan.domains.map((d, i) => [i === 0 ? "a" : "b", d]));
	const byMailbox = Object.fromEntries(plan.mailboxes.map((m) => [m.localPart === "alpha" ? "a" : m.localPart === "beta" ? "b" : "shared", m]));

	lines.push(`DELETE FROM organizations WHERE id = ${sqlString(org.id)};`);
	lines.push(
		`INSERT INTO organizations (id, name, created_at, updated_at) VALUES (${sqlString(org.id)}, ${sqlString(org.name)}, ${now}, ${now});`,
	);

	for (const user of plan.users) {
		lines.push(`DELETE FROM users WHERE id = ${sqlString(user.id)};`);
		lines.push(
			`INSERT INTO users (id, email, password_hash, name, organization_id, created_at) VALUES (${sqlString(user.id)}, ${sqlString(user.email)}, ${sqlString(passwordHash)}, ${sqlString(user.name)}, ${sqlString(org.id)}, ${now});`,
		);
		lines.push(
			`INSERT INTO organization_members (id, organization_id, user_id, role, created_at) VALUES (${sqlString(seedId("om", user.role))}, ${sqlString(org.id)}, ${sqlString(user.id)}, ${sqlString(user.role)}, ${now});`,
		);
	}

	for (const [key, domain] of Object.entries(byDomain)) {
		lines.push(`DELETE FROM domains WHERE id = ${sqlString(domain.id)};`);
		lines.push(
			`INSERT INTO domains (id, user_id, organization_id, hostname, zone_id, status, sending_enabled, routing_enabled, created_at) VALUES (${sqlString(domain.id)}, ${sqlString(byUser.owner.id)}, ${sqlString(org.id)}, ${sqlString(domain.hostname)}, ${sqlString(`zone_${key}`)}, 'active', 1, 1, ${now});`,
		);
	}

	for (const [key, mailbox] of Object.entries(byMailbox)) {
		lines.push(`DELETE FROM mailboxes WHERE id = ${sqlString(mailbox.id)};`);
		lines.push(
			`INSERT INTO mailboxes (id, user_id, organization_id, domain_id, local_part, display_name, created_at) VALUES (${sqlString(mailbox.id)}, ${sqlString(byUser.owner.id)}, ${sqlString(org.id)}, ${sqlString(byDomain[mailbox.domain].id)}, ${sqlString(mailbox.localPart)}, ${sqlString(mailbox.localPart)}, ${now});`,
		);
		void key;
	}

	for (const membership of plan.memberships) {
		const id = seedId("mbm", `${membership.mailbox}${membership.user}`);
		lines.push(`DELETE FROM mailbox_memberships WHERE id = ${sqlString(id)};`);
		lines.push(
			`INSERT INTO mailbox_memberships (id, mailbox_id, user_id, role, created_at, updated_at) VALUES (${sqlString(id)}, ${sqlString(byMailbox[membership.mailbox].id)}, ${sqlString(byUser[membership.user].id)}, ${sqlString(membership.role)}, ${now}, ${now});`,
		);
	}

	return lines.join("\n");
}

async function main() {
	const args = process.argv.slice(2);
	const domain = args[args.indexOf("--domain") + 1];
	const password = args[args.indexOf("--password") + 1];
	if (!args.includes("--domain") || !args.includes("--password") || !domain || !password) {
		console.error("Usage: node scripts/seed-staging.mjs --domain <hostname> --password <password>");
		process.exitCode = 1;
		return;
	}

	// The second domain is a subdomain of the first, so one registration covers both
	// parties in a domain-to-domain test.
	const plan = seedPlan(domain, `mail.${domain}`);

	// Hash with the same library and cost the application uses, so the seeded
	// password actually authenticates.
	const { default: bcrypt } = await import("bcryptjs");
	const sql = renderSeedSql(plan, bcrypt.hashSync(password, 10), Math.floor(Date.now() / 1000));

	execFileSync(
		process.execPath,
		[resolve("node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "DB", "--env", "staging", "--remote", "--command", sql],
		{ stdio: "inherit", env: { ...process.env, WRANGLER_LOG: "none" } },
	);

	console.log(`Seeded ${plan.users.length} users, ${plan.domains.length} domains, ${plan.mailboxes.length} mailboxes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
