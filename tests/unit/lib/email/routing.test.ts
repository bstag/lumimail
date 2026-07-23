import { beforeEach, describe, expect, it } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";
import type { AppDatabase } from "@/db";

import { resolveInboundAddress, resolveInboundTargets } from "@/lib/email/routing";

let mock: DbMock;
let db: AppDatabase;

beforeEach(() => {
	mock = createDbMock();
	db = mock.db as unknown as AppDatabase;
});

const activeDomain = { id: "dom_1", hostname: "example.com", status: "active", zoneId: "z1" };

describe("resolveInboundTargets", () => {
	it("returns [] for an unparseable address", async () => {
		expect(await resolveInboundTargets(db, "not-an-address")).toEqual([]);
	});

	it("returns [] when the domain is not found", async () => {
		mock.queueSelect([]); // domain lookup
		expect(await resolveInboundTargets(db, "a@example.com")).toEqual([]);
	});

	it("falls back to direct mailbox delivery when no alias matches", async () => {
		mock
			.queueSelect([activeDomain]) // domain (targets)
			.queueSelect([]) // alias lookup -> none
			// resolveInboundAddress re-runs its own lookups:
			.queueSelect([activeDomain]) // domain
			.queueSelect([]) // routing rules
			.queueSelect([{ id: "mb_1", userId: "u1", localPart: "a", displayName: "A" }]); // direct mailbox

		const result = await resolveInboundTargets(db, "a@example.com");
		expect(result).toEqual([
			{
				action: "store",
				mailbox: {
					mailboxId: "mb_1",
					userId: "u1",
					domainId: "dom_1",
					localPart: "a",
					hostname: "example.com",
					displayName: "A",
				},
			},
		]);
	});

	it("expands a simple alias to a single mailbox decision", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ id: "al_1", domainId: "dom_1", localPart: "info", isGroup: false, targetMailboxId: "mb_9", forwardTo: null }]) // alias
			.queueSelect([{ id: "mb_9", userId: "u9", localPart: "info", domainId: "dom_1", displayName: null }]); // loadMailboxDecision

		const result = await resolveInboundTargets(db, "info@example.com");
		expect(result).toEqual([
			{
				action: "store",
				mailbox: {
					mailboxId: "mb_9",
					userId: "u9",
					domainId: "dom_1",
					localPart: "info",
					hostname: "example.com",
					displayName: null,
				},
			},
		]);
	});

	it("expands a simple alias forward target", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ id: "al_1", domainId: "dom_1", localPart: "fwd", isGroup: false, targetMailboxId: null, forwardTo: "ext@other.com" }]); // alias

		const result = await resolveInboundTargets(db, "fwd@example.com");
		expect(result).toEqual([{ action: "forward", forwardTo: "ext@other.com" }]);
	});

	it("skips a mailbox alias target whose mailbox row is missing", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ id: "al_1", domainId: "dom_1", localPart: "x", isGroup: false, targetMailboxId: "mb_gone", forwardTo: null }]) // alias
			.queueSelect([]) // loadMailboxDecision -> missing
			// decisions empty -> fallback to resolveInboundAddress
			.queueSelect([activeDomain]) // domain
			.queueSelect([]) // rules
			.queueSelect([]); // direct mailbox -> none

		const result = await resolveInboundTargets(db, "x@example.com");
		expect(result).toEqual([]);
	});

	it("fans out a group alias to internal mailbox members and external members", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ id: "al_g", domainId: "dom_1", localPart: "team", isGroup: true, targetMailboxId: null, forwardTo: null }]) // alias
			.queueSelect([
				{ aliasId: "al_g", userId: "u1", email: null }, // internal -> mailbox lookup
				{ aliasId: "al_g", userId: null, email: "ext@other.com" }, // external
			]) // group members
			.queueSelect([{ id: "mb_1" }]) // mailbox lookup for u1
			// expandAliasTargets yields [mailbox mb_1, forward ext@other.com]
			.queueSelect([{ id: "mb_1", userId: "u1", localPart: "team", domainId: "dom_1", displayName: "Team" }]); // loadMailboxDecision

		const result = await resolveInboundTargets(db, "team@example.com");
		expect(result).toEqual([
			{
				action: "store",
				mailbox: {
					mailboxId: "mb_1",
					userId: "u1",
					domainId: "dom_1",
					localPart: "team",
					hostname: "example.com",
					displayName: "Team",
				},
			},
			{ action: "forward", forwardTo: "ext@other.com" },
		]);
	});

	it("treats an internal group member with no mailbox as external email", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ id: "al_g", domainId: "dom_1", localPart: "team", isGroup: true, targetMailboxId: null, forwardTo: null }]) // alias
			.queueSelect([{ aliasId: "al_g", userId: "u1", email: "fallback@other.com" }]) // member with userId
			.queueSelect([]); // mailbox lookup for u1 -> none, so falls back to row.email

		const result = await resolveInboundTargets(db, "team@example.com");
		expect(result).toEqual([{ action: "forward", forwardTo: "fallback@other.com" }]);
	});

	it("falls back when an alias produces no targets", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ id: "al_g", domainId: "dom_1", localPart: "team", isGroup: true, targetMailboxId: null, forwardTo: null }]) // empty group alias
			.queueSelect([]) // group members -> none, expandAliasTargets -> []
			// fallback resolveInboundAddress:
			.queueSelect([activeDomain]) // domain
			.queueSelect([]) // rules
			.queueSelect([{ id: "mb_d", userId: "ud", localPart: "team", displayName: null }]); // direct mailbox

		const result = await resolveInboundTargets(db, "team@example.com");
		expect(result).toEqual([
			{
				action: "store",
				mailbox: {
					mailboxId: "mb_d",
					userId: "ud",
					domainId: "dom_1",
					localPart: "team",
					hostname: "example.com",
					displayName: null,
				},
			},
		]);
	});
});

describe("resolveInboundAddress", () => {
	it("returns null for an unparseable address", async () => {
		expect(await resolveInboundAddress(db, "garbage")).toBeNull();
	});

	it("returns null when the domain is missing", async () => {
		mock.queueSelect([]);
		expect(await resolveInboundAddress(db, "a@example.com")).toBeNull();
	});

	it("returns reject when a matching rule rejects", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ id: "r1", domainId: "dom_1", pattern: "*", action: "reject", forwardTo: null, mailboxId: null, priority: 1 }]);
		expect(await resolveInboundAddress(db, "a@example.com")).toEqual({ action: "reject" });
	});

	it("returns forward when a forward rule with a target matches the local part", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ id: "r1", domainId: "dom_1", pattern: "a", action: "forward", forwardTo: "ext@x.com", mailboxId: null, priority: 1 }]);
		expect(await resolveInboundAddress(db, "a@example.com")).toEqual({ action: "forward", forwardTo: "ext@x.com" });
	});

	it("stores to the mailbox referenced by a matching rule", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ id: "r1", domainId: "dom_1", pattern: "a@example.com", action: "store", forwardTo: null, mailboxId: "mb_r", priority: 5 }])
			.queueSelect([{ id: "mb_r", userId: "ur", localPart: "a", displayName: "Rule MB" }]);
		expect(await resolveInboundAddress(db, "a@example.com")).toEqual({
			action: "store",
			mailbox: {
				mailboxId: "mb_r",
				userId: "ur",
				domainId: "dom_1",
				localPart: "a",
				hostname: "example.com",
				displayName: "Rule MB",
			},
		});
	});

	it("returns null when a rule references a missing mailbox", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ id: "r1", domainId: "dom_1", pattern: "*", action: "store", forwardTo: null, mailboxId: "mb_gone", priority: 1 }])
			.queueSelect([]); // mailbox missing
		expect(await resolveInboundAddress(db, "a@example.com")).toBeNull();
	});

	it("ignores a forward rule that has no forwardTo and a rule whose pattern does not match", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([
				{ id: "r0", domainId: "dom_1", pattern: "other", action: "store", forwardTo: null, mailboxId: "mb_x", priority: 9 }, // pattern mismatch
				{ id: "r1", domainId: "dom_1", pattern: "a", action: "forward", forwardTo: null, mailboxId: null, priority: 1 }, // forward without target, no mailboxId
			])
			.queueSelect([{ id: "mb_direct", userId: "ud", localPart: "a", displayName: null }]); // direct fallback
		expect(await resolveInboundAddress(db, "a@example.com")).toEqual({
			action: "store",
			mailbox: {
				mailboxId: "mb_direct",
				userId: "ud",
				domainId: "dom_1",
				localPart: "a",
				hostname: "example.com",
				displayName: null,
			},
		});
	});

	it("falls back to direct mailbox delivery when no rule matches", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([]) // no rules
			.queueSelect([{ id: "mb_d", userId: "ud", localPart: "a", displayName: "Direct" }]);
		expect(await resolveInboundAddress(db, "a@example.com")).toEqual({
			action: "store",
			mailbox: {
				mailboxId: "mb_d",
				userId: "ud",
				domainId: "dom_1",
				localPart: "a",
				hostname: "example.com",
				displayName: "Direct",
			},
		});
	});

	it("returns null when no rule matches and there is no direct mailbox", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([])
			.queueSelect([]);
		expect(await resolveInboundAddress(db, "a@example.com")).toBeNull();
	});

	it("uses exact-address rules before local-part rules and catch-all regardless of priority", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([
				{ id: "wild", pattern: "*", action: "reject", priority: 100 },
				{ id: "local", pattern: "admin", action: "reject", priority: 50 },
				{ id: "exact", pattern: "admin@example.com", action: "store", mailboxId: "mb_exact", priority: 1 },
			])
			.queueSelect([{ id: "mb_exact", userId: "u1", localPart: "admin", displayName: null }]);

		expect(await resolveInboundAddress(db, "ADMIN@EXAMPLE.COM")).toMatchObject({
			action: "store",
			mailbox: { mailboxId: "mb_exact", domainId: "dom_1" },
		});
	});

	it("uses a local-part rule before a higher-priority catch-all", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([
				{ id: "wild", pattern: "*", action: "reject", priority: 100 },
				{ id: "local", pattern: "admin", action: "store", mailboxId: "mb_local", priority: 1 },
			])
			.queueSelect([{ id: "mb_local", userId: "u1", localPart: "admin", displayName: null }]);

		expect(await resolveInboundAddress(db, "admin@example.com")).toMatchObject({
			action: "store",
			mailbox: { mailboxId: "mb_local" },
		});
	});

	it("delivers to a direct mailbox before applying catch-all", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ id: "wild", pattern: "*", action: "reject", priority: 100 }])
			.queueSelect([{ id: "mb_direct", userId: "u1", localPart: "support", displayName: "Support" }]);

		expect(await resolveInboundAddress(db, "support@example.com")).toMatchObject({
			action: "store",
			mailbox: { mailboxId: "mb_direct" },
		});
	});

	it("applies catch-all only after confirming no direct mailbox exists", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ id: "wild", pattern: "*", action: "store", mailboxId: "mb_catch", priority: 1 }])
			.queueSelect([])
			.queueSelect([{ id: "mb_catch", userId: "owner", localPart: "admin", displayName: null }]);

		expect(await resolveInboundAddress(db, "unknown@example.com")).toMatchObject({
			action: "store",
			mailbox: { mailboxId: "mb_catch", userId: "owner" },
		});
	});

	it("does not apply another domain's catch-all", async () => {
		mock
			.queueSelect([{ ...activeDomain, id: "dom_2", hostname: "second.test" }])
			.queueSelect([])
			.queueSelect([]);

		expect(await resolveInboundAddress(db, "unknown@second.test")).toBeNull();
	});

	it("skips a store rule without a mailbox target and falls back to the direct mailbox", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ id: "broken", pattern: "a", action: "store", mailboxId: null, priority: 1 }])
			.queueSelect([{ id: "mb_direct", userId: "u1", localPart: "a", displayName: null }]);
		expect(await resolveInboundAddress(db, "a@example.com")).toMatchObject({ mailbox: { mailboxId: "mb_direct" } });
	});

	it("skips non-catch-all rules after direct mailbox lookup and returns no match", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ id: "other", pattern: "other", action: "reject", priority: 1 }])
			.queueSelect([]);
		expect(await resolveInboundAddress(db, "unknown@example.com")).toBeNull();
	});
});
