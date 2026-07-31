import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	ensureRoute: vi.fn(),
	deleteRule: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/ids", () => ({ newId: (p?: string) => (p ? `${p}_1` : "id_1") }));
vi.mock("@/lib/cloudflare-api", () => ({
	ensureOwnedEmailRoutingRuleToWorker: m.ensureRoute,
	deleteEmailRoutingRule: m.deleteRule,
}));

import { createAlias, deleteAlias } from "@/lib/email/alias-service";

const env = {} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.ensureRoute.mockReset().mockResolvedValue({ rule: { id: "cf_rule_1" }, created: true });
	m.deleteRule.mockReset().mockResolvedValue(undefined);
});

const activeDomain = {
	id: "d1",
	organizationId: "o1",
	hostname: "example.test",
	zoneId: "z1",
	status: "active",
};
const mailboxInput = { kind: "mailbox" as const, domainId: "d1", localPart: "info", targetMailboxId: "mb1" };
const groupInput = { kind: "group" as const, domainId: "d1", localPart: "team", mailboxIds: ["mb1", "mb2"] };

describe("createAlias", () => {
	it("fails when the domain is missing, inactive, or cross-tenant", async () => {
		mock.queueSelect([]);
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "domain_not_found" });
		expect(m.ensureRoute).not.toHaveBeenCalled();
	});

	it("fails when the returned domain belongs to another organization", async () => {
		mock.queueSelect([{ ...activeDomain, organizationId: "other" }]);
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "domain_not_found" });
	});

	it("refuses an address already used by a mailbox", async () => {
		mock.queueSelect([activeDomain]).queueSelect([{ id: "mb-existing" }]);
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "address_taken" });
		expect(m.ensureRoute).not.toHaveBeenCalled();
	});

	it("refuses an address already used by an alias", async () => {
		mock.queueSelect([activeDomain]).queueSelect([]).queueSelect([{ id: "alias-existing" }]);
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "address_taken" });
		expect(m.ensureRoute).not.toHaveBeenCalled();
	});

	it("fails when any target mailbox is missing or cross-tenant", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([])
			.queueSelect([])
			.queueSelect([{ id: "mb1" }]); // only one of the two group targets found
		expect(await createAlias(env, "o1", groupInput)).toEqual({ ok: false, error: "mailbox_not_found" });
		expect(m.ensureRoute).not.toHaveBeenCalled();
	});

	it("fails without writing D1 when Cloudflare provisioning throws", async () => {
		mock.queueSelect([activeDomain]).queueSelect([]).queueSelect([]).queueSelect([{ id: "mb1" }]);
		m.ensureRoute.mockRejectedValue(new Error("provider failed"));
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "provision_failed" });
		expect(mock.inserts).toHaveLength(0);
	});

	it("fails closed when a newly created provider rule has no ID", async () => {
		mock.queueSelect([activeDomain]).queueSelect([]).queueSelect([]).queueSelect([{ id: "mb1" }]);
		m.ensureRoute.mockResolvedValue({ rule: {}, created: true });
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "provision_failed" });
		expect(mock.inserts).toHaveLength(0);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it("creates a mailbox alias and records the owned Cloudflare rule", async () => {
		mock.queueSelect([activeDomain]).queueSelect([]).queueSelect([]).queueSelect([{ id: "mb1" }]);
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({
			ok: true,
			id: "alias_1",
			address: "info@example.test",
		});
		expect(m.ensureRoute).toHaveBeenCalledWith(env, "z1", "info@example.test");
		expect(mock.inserts[0].values).toMatchObject({
			id: "alias_1",
			organizationId: "o1",
			targetMailboxId: "mb1",
			isGroup: false,
			cloudflareRuleId: "cf_rule_1",
		});
	});

	it("creates a group with its members in one D1 batch", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([])
			.queueSelect([])
			.queueSelect([{ id: "mb1" }, { id: "mb2" }]);
		expect(await createAlias(env, "o1", groupInput)).toEqual({
			ok: true,
			id: "alias_1",
			address: "team@example.test",
		});
		expect(mock.inserts[0].values).toMatchObject({ isGroup: true, targetMailboxId: null });
		expect(mock.inserts[1].values).toEqual([
			expect.objectContaining({ aliasId: "alias_1", mailboxId: "mb1" }),
			expect.objectContaining({ aliasId: "alias_1", mailboxId: "mb2" }),
		]);
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
	});

	it("compensates a newly created provider rule when the D1 batch fails", async () => {
		mock.queueSelect([activeDomain]).queueSelect([]).queueSelect([]).queueSelect([{ id: "mb1" }]);
		mock.db.batch.mockRejectedValueOnce(new Error("D1 failed"));
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "create_failed" });
		expect(m.deleteRule).toHaveBeenCalledWith(env, "z1", "cf_rule_1");
	});

	it("never deletes a reused manual provider rule during compensation", async () => {
		mock.queueSelect([activeDomain]).queueSelect([]).queueSelect([]).queueSelect([{ id: "mb1" }]);
		m.ensureRoute.mockResolvedValue({ rule: { id: "manual-rule" }, created: false });
		mock.db.batch.mockRejectedValueOnce(new Error("D1 failed"));
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "create_failed" });
		expect(m.deleteRule).not.toHaveBeenCalled();
	});

	it("stores no rule id for a reused manual provider rule on success", async () => {
		mock.queueSelect([activeDomain]).queueSelect([]).queueSelect([]).queueSelect([{ id: "mb1" }]);
		m.ensureRoute.mockResolvedValue({ rule: { id: "manual-rule" }, created: false });
		const result = await createAlias(env, "o1", mailboxInput);
		expect(result).toMatchObject({ ok: true });
		expect(mock.inserts[0].values).toMatchObject({ cloudflareRuleId: null });
	});

	it("reports a compensation cleanup failure without hiding the D1 failure", async () => {
		mock.queueSelect([activeDomain]).queueSelect([]).queueSelect([]).queueSelect([{ id: "mb1" }]);
		mock.db.batch.mockRejectedValueOnce(new Error("D1 failed"));
		m.deleteRule.mockRejectedValueOnce(new Error("cleanup failed"));
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(await createAlias(env, "o1", mailboxInput)).toEqual({ ok: false, error: "create_failed" });
		expect(error).toHaveBeenCalledWith("Failed to compensate Cloudflare alias routing rule");
		error.mockRestore();
	});
});

describe("deleteAlias", () => {
	it("fails when the alias is missing or cross-tenant", async () => {
		mock.queueSelect([]);
		expect(await deleteAlias(env, "o1", "a1")).toEqual({ ok: false, error: "not_found" });
		expect(mock.deletes).toHaveLength(0);
	});

	it("removes the owned Cloudflare rule before deleting the row", async () => {
		mock.queueSelect([{ id: "a1", organizationId: "o1", zoneId: "z1", cloudflareRuleId: "cf_rule_1" }]);
		expect(await deleteAlias(env, "o1", "a1")).toEqual({ ok: true });
		expect(m.deleteRule).toHaveBeenCalledWith(env, "z1", "cf_rule_1");
		expect(mock.deletes).toHaveLength(1);
	});

	it("keeps the D1 row when Cloudflare cleanup fails", async () => {
		mock.queueSelect([{ id: "a1", organizationId: "o1", zoneId: "z1", cloudflareRuleId: "cf_rule_1" }]);
		m.deleteRule.mockRejectedValue(new Error("provider failed"));
		expect(await deleteAlias(env, "o1", "a1")).toEqual({ ok: false, error: "cloudflare_failed" });
		expect(mock.deletes).toHaveLength(0);
	});

	it("leaves a reused manual provider rule alone", async () => {
		mock.queueSelect([{ id: "a1", organizationId: "o1", zoneId: "z1", cloudflareRuleId: null }]);
		expect(await deleteAlias(env, "o1", "a1")).toEqual({ ok: true });
		expect(m.deleteRule).not.toHaveBeenCalled();
		expect(mock.deletes).toHaveLength(1);
	});
});
