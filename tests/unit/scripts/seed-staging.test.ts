import { describe, expect, it } from "vitest";
// Operational script, deliberately outside src/ so it is not bundled into the Worker.
import { renderSeedSql, seedId, seedPlan } from "../../../scripts/seed-staging.mjs";

const plan = seedPlan("staging.test", "mail.staging.test");
const sql = renderSeedSql(plan, "$2b$10$hash", 1784000000) as string;

describe("seedPlan", () => {
	it("puts the two mailboxes on different domains so cross-domain flow is testable", () => {
		type SeedMailbox = { localPart: string; domain: string };
		const mailboxes = plan.mailboxes as SeedMailbox[];
		const alpha = mailboxes.find((m) => m.localPart === "alpha");
		const beta = mailboxes.find((m) => m.localPart === "beta");

		// Their existence is part of the contract, not an assumption.
		expect(alpha).toBeDefined();
		expect(beta).toBeDefined();
		expect(alpha?.domain).not.toBe(beta?.domain);
	});

	it("gives the shared mailbox two members with different roles", () => {
		// F47 isolation and F65 responder scoping cannot be tested without this.
		const shared = plan.memberships.filter((m: { mailbox: string }) => m.mailbox === "shared");

		expect(shared).toHaveLength(2);
		expect(new Set(shared.map((m: { role: string }) => m.role))).toEqual(
			new Set(["manager", "responder"]),
		);
	});

	it("derives every address from the supplied domain", () => {
		expect(plan.users.every((u: { email: string }) => u.email.endsWith("@staging.test"))).toBe(true);
	});
});

describe("renderSeedSql", () => {
	it("deletes before inserting so re-seeding replaces rather than duplicates", () => {
		const deleteIndex = sql.indexOf(`DELETE FROM users WHERE id = '${seedId("usr", "owner")}'`);
		const insertIndex = sql.indexOf(`INSERT INTO users`);

		expect(deleteIndex).toBeGreaterThan(-1);
		expect(deleteIndex).toBeLessThan(insertIndex);
	});

	it("writes the supplied password hash rather than a placeholder", () => {
		expect(sql).toContain("'$2b$10$hash'");
	});

	it("creates the organization before the users that reference it", () => {
		expect(sql.indexOf("INSERT INTO organizations")).toBeLessThan(sql.indexOf("INSERT INTO users"));
	});

	it("creates domains before the mailboxes that reference them", () => {
		expect(sql.indexOf("INSERT INTO domains")).toBeLessThan(sql.indexOf("INSERT INTO mailboxes"));
	});

	it("creates mailboxes before the memberships that reference them", () => {
		expect(sql.indexOf("INSERT INTO mailboxes")).toBeLessThan(
			sql.indexOf("INSERT INTO mailbox_memberships"),
		);
	});

	it("escapes a quote in a domain rather than breaking out of the literal", () => {
		const hostile = renderSeedSql(seedPlan("bad'domain", "b"), "h", 1) as string;

		// Doubled, per SQL string escaping — not left to terminate the literal early.
		expect(hostile).toContain("bad''domain");
	});
});
