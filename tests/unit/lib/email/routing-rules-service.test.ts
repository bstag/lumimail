import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";
import type { AppDatabase } from "@/db";

const m = vi.hoisted(() => ({
	ensureCatchAll: vi.fn(),
	disableCatchAll: vi.fn(),
	authorizeForwardDestination: vi.fn(),
}));
vi.mock("@/lib/cloudflare-api", () => ({
	ensureEmailRoutingCatchAllToWorker: m.ensureCatchAll,
	disableEmailRoutingCatchAllToWorker: m.disableCatchAll,
}));
vi.mock("@/lib/email/forwarding", () => ({
	authorizeForwardDestination: m.authorizeForwardDestination,
}));

import {
	authorizeForwardTarget,
	domainHasCatchAllRule,
	forwardRefusalMessage,
	getOrgDomain,
	hasOtherCatchAllInZone,
	storeTargetMailboxExists,
	syncCatchAllTransition,
} from "@/lib/email/routing-rules-service";

const env = {} as CloudflareEnv;
let mock: DbMock;
let db: AppDatabase;

beforeEach(() => {
	mock = createDbMock();
	db = mock.db as unknown as AppDatabase;
	m.ensureCatchAll.mockReset().mockResolvedValue({ enabled: true });
	m.disableCatchAll.mockReset().mockResolvedValue({ enabled: false });
	m.authorizeForwardDestination.mockReset();
});

const domain = { id: "dom_1", hostname: "x.test", zoneId: "z1" };

describe("getOrgDomain", () => {
	it("returns the organization's domain row", async () => {
		mock.queueSelect([{ id: "dom_1", organizationId: "org1" }]);
		expect(await getOrgDomain(db, "org1", "dom_1")).toEqual({ id: "dom_1", organizationId: "org1" });
	});

	it("returns null when the domain is missing or cross-tenant", async () => {
		mock.queueSelect([]);
		expect(await getOrgDomain(db, "org1", "dom_other")).toBeNull();
	});
});

describe("storeTargetMailboxExists", () => {
	it("is true when the mailbox exists on the domain within the org", async () => {
		mock.queueSelect([{ id: "mb_1" }]);
		expect(await storeTargetMailboxExists(db, "org1", "dom_1", "mb_1")).toBe(true);
	});

	it("is false when the mailbox is missing, cross-domain, or cross-tenant", async () => {
		mock.queueSelect([]);
		expect(await storeTargetMailboxExists(db, "org1", "dom_1", "mb_gone")).toBe(false);
	});
});

describe("domainHasCatchAllRule", () => {
	it("detects any spelling that normalizes to the catch-all", async () => {
		mock.queueSelect([
			{ id: "r0", pattern: "bad*pattern" },
			{ id: "r1", pattern: "*@x.test" },
		]);
		expect(await domainHasCatchAllRule(db, domain)).toBe(true);
	});

	it("ignores named rules and the excluded rule id", async () => {
		mock.queueSelect([{ id: "r2", pattern: "admin" }]);
		expect(await domainHasCatchAllRule(db, domain, "r1")).toBe(false);
	});
});

describe("hasOtherCatchAllInZone", () => {
	it("finds a surviving catch-all on another domain in the zone", async () => {
		mock.queueSelect([{ pattern: "*@second.x.test", hostname: "second.x.test" }]);
		expect(await hasOtherCatchAllInZone(db, "org1", "z1", "rule_1")).toBe(true);
	});

	it("ignores rows that do not normalize to a catch-all", async () => {
		mock.queueSelect([
			{ pattern: "bad*pattern", hostname: "x.test" },
			{ pattern: "admin", hostname: "x.test" },
		]);
		expect(await hasOtherCatchAllInZone(db, "org1", "z1", "rule_1")).toBe(false);
	});
});

describe("syncCatchAllTransition", () => {
	it("provisions the zone catch-all when the rule becomes one", async () => {
		const result = await syncCatchAllTransition(env, db, {
			organizationId: "org1",
			domain,
			wasCatchAll: false,
			isCatchAll: true,
		});
		expect(result).toEqual({ ok: true });
		expect(m.ensureCatchAll).toHaveBeenCalledWith(env, "z1");
		expect(m.disableCatchAll).not.toHaveBeenCalled();
	});

	it("disables the zone catch-all when the last catch-all leaves", async () => {
		mock.queueSelect([]); // no other catch-all in the zone
		const result = await syncCatchAllTransition(env, db, {
			organizationId: "org1",
			domain,
			ruleId: "rule_1",
			wasCatchAll: true,
			isCatchAll: false,
		});
		expect(result).toEqual({ ok: true });
		expect(m.disableCatchAll).toHaveBeenCalledWith(env, "z1");
	});

	it("keeps the zone catch-all when another rule in the zone still uses it", async () => {
		mock.queueSelect([{ pattern: "*@second.x.test", hostname: "second.x.test" }]);
		const result = await syncCatchAllTransition(env, db, {
			organizationId: "org1",
			domain,
			ruleId: "rule_1",
			wasCatchAll: true,
			isCatchAll: false,
		});
		expect(result).toEqual({ ok: true });
		expect(m.disableCatchAll).not.toHaveBeenCalled();
	});

	it("never disables without a rule id to exclude", async () => {
		// A creation flow has no rule to exclude from the zone scan, so the
		// release path is unreachable by construction; the guard keeps it that way.
		const result = await syncCatchAllTransition(env, db, {
			organizationId: "org1",
			domain,
			wasCatchAll: true,
			isCatchAll: false,
		});
		expect(result).toEqual({ ok: true });
		expect(m.disableCatchAll).not.toHaveBeenCalled();
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("does nothing for a named-to-named transition", async () => {
		const result = await syncCatchAllTransition(env, db, {
			organizationId: "org1",
			domain,
			ruleId: "rule_1",
			wasCatchAll: false,
			isCatchAll: false,
		});
		expect(result).toEqual({ ok: true });
		expect(m.ensureCatchAll).not.toHaveBeenCalled();
		expect(m.disableCatchAll).not.toHaveBeenCalled();
	});

	it("maps a provider catch-all conflict to a typed conflict", async () => {
		m.ensureCatchAll.mockRejectedValue(
			Object.assign(new Error("conflict"), { name: "CloudflareCatchAllConflictError" }),
		);
		const result = await syncCatchAllTransition(env, db, {
			organizationId: "org1",
			domain,
			wasCatchAll: false,
			isCatchAll: true,
		});
		expect(result).toEqual({ ok: false, error: "conflict" });
	});

	it("maps any other provider failure without leaking its detail", async () => {
		mock.queueSelect([]);
		m.disableCatchAll.mockRejectedValue(new Error("token detail"));
		const result = await syncCatchAllTransition(env, db, {
			organizationId: "org1",
			domain,
			ruleId: "rule_1",
			wasCatchAll: true,
			isCatchAll: false,
		});
		expect(result).toEqual({ ok: false, error: "provider" });
	});
});

describe("authorizeForwardTarget", () => {
	it("passes an allowed destination through", async () => {
		m.authorizeForwardDestination.mockResolvedValue({ allowed: true });
		expect(await authorizeForwardTarget(db, "org1", "outside@example.net")).toEqual({ allowed: true });
	});

	it("returns the user-facing refusal message for a denied destination", async () => {
		m.authorizeForwardDestination.mockResolvedValue({ allowed: false, reason: "not_verified" });
		expect(await authorizeForwardTarget(db, "org1", "outside@example.net")).toEqual({
			allowed: false,
			message: "That destination has not confirmed Cloudflare's verification email yet",
		});
	});
});

describe("forwardRefusalMessage", () => {
	it("explains each refusal reason without exposing internal state", () => {
		expect(forwardRefusalMessage("invalid_address")).toBe(
			"A valid forwarding destination is required",
		);
		expect(forwardRefusalMessage("managed_domain")).toBe(
			"Cannot forward to an address on a domain Lumimail manages",
		);
		expect(forwardRefusalMessage("not_verified")).toBe(
			"That destination has not confirmed Cloudflare's verification email yet",
		);
		expect(forwardRefusalMessage("not_owned")).toBe(
			"Register this forwarding destination before using it",
		);
	});
});
