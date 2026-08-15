import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	hashPassword: vi.fn(),
	hashInvitationToken: vi.fn(),
	addDomainForUser: vi.fn(),
	ensureEmailRoutingRuleToWorker: vi.fn(),
	ensureUserOrg: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: m.hashPassword }));
vi.mock("@/lib/auth/invitation", () => ({ hashInvitationToken: m.hashInvitationToken }));
vi.mock("@/lib/ids", () => ({ newId: (p?: string) => (p ? `${p}_1` : "id_1") }));
vi.mock("@/lib/domains/service", () => ({ addDomainForUser: m.addDomainForUser }));
vi.mock("@/lib/cloudflare-api", () => ({
	ensureEmailRoutingRuleToWorker: m.ensureEmailRoutingRuleToWorker,
}));
vi.mock("@/lib/migration/backfill-orgs", () => ({ ensureUserOrg: m.ensureUserOrg }));

import { registerFirstRunUser, registerFromInvite } from "@/lib/auth/registration";

const env = {} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.hashPassword.mockReset().mockReturnValue("pw-hash");
	m.hashInvitationToken.mockReset().mockResolvedValue("hashed-token");
	m.addDomainForUser.mockReset();
	m.ensureEmailRoutingRuleToWorker.mockReset().mockResolvedValue(undefined);
	m.ensureUserOrg.mockReset().mockResolvedValue("org_1");
});

const inviteInput = {
	inviteToken: "good",
	password: "longenough",
	resetEmail: "ada@reset.test",
};

const invite = {
	id: "inv_1",
	organizationId: "org_inv",
	email: "Teammate@External.test",
	role: "member",
	token: "hashed-token",
	expiresAt: new Date(Date.now() + 60_000),
	createdAt: new Date(Date.now() - 60_000),
	deliveryStatus: "sent",
	lastDeliveryAttemptAt: new Date(Date.now() - 60_000),
	lastDeliveredAt: new Date(Date.now() - 60_000),
	acceptedAt: null,
};

describe("registerFromInvite", () => {
	it("fails when the token matches no live invite", async () => {
		mock.queueSelect([]);
		expect(await registerFromInvite(env, { ...inviteInput, inviteToken: "bad" })).toEqual({
			ok: false,
			error: "invite_not_found",
		});
		expect(m.hashInvitationToken).toHaveBeenCalledWith("bad");
	});

	it("fails without consuming the invite when its identity is already registered", async () => {
		mock.queueSelect([invite]).queueSelect([{ id: "usr_existing" }]);
		expect(await registerFromInvite(env, inviteInput)).toEqual({ ok: false, error: "email_taken" });
		expect(mock.deletes).toHaveLength(0);
	});

	it("reports a claim conflict when another request consumes the invite first", async () => {
		mock.queueSelect([invite]).queueSelect([]).queueSelect([]); // claim lost
		expect(await registerFromInvite(env, inviteInput)).toEqual({ ok: false, error: "claim_conflict" });
		expect(mock.db.batch).not.toHaveBeenCalled();
	});

	it("creates the user and membership from the invite's normalized identity", async () => {
		mock.queueSelect([invite]).queueSelect([]).queueSelect([invite]); // claim won
		expect(await registerFromInvite(env, inviteInput)).toEqual({ ok: true, userId: "usr_1" });
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
		expect(mock.deletes).toHaveLength(0);
		expect(mock.updates[0].set).toMatchObject({ acceptedAt: expect.any(Date) });
		expect(mock.inserts[0].values).toMatchObject({
			id: "usr_1",
			email: "teammate@external.test",
			name: "teammate",
			passwordHash: "pw-hash",
			organizationId: "org_inv",
		});
		expect(mock.inserts[1].values).toMatchObject({
			organizationId: "org_inv",
			userId: "usr_1",
			role: "member",
		});
	});

	it("restores claimability when the account batch fails", async () => {
		mock.queueSelect([invite]).queueSelect([]).queueSelect([invite]);
		mock.db.batch.mockRejectedValueOnce(new Error("D1 unavailable"));
		expect(await registerFromInvite(env, inviteInput)).toEqual({ ok: false, error: "unavailable" });
		expect(mock.updates.at(-1)?.set).toEqual({ acceptedAt: null });
		expect(mock.inserts).toHaveLength(2);
	});
});

const firstRunInput = {
	domain: "Example.com ",
	username: " Ada",
	password: "longenough",
	resetEmail: "ada@reset.test",
};

describe("registerFirstRunUser", () => {
	it("fails when the composed email is already registered", async () => {
		mock.queueSelect([{ id: "u-old", email: "ada@example.com" }]);
		expect(await registerFirstRunUser(env, firstRunInput)).toEqual({ ok: false, error: "email_taken" });
		expect(mock.inserts).toHaveLength(0);
	});

	it("creates the user, org, domain, routing rule, and mailbox", async () => {
		mock.queueSelect([]);
		m.addDomainForUser.mockResolvedValue({ domain: { id: "dom_1", zoneId: "zone_1" } });
		expect(await registerFirstRunUser(env, firstRunInput)).toEqual({ ok: true, userId: "usr_1" });
		expect(mock.inserts[0].values).toMatchObject({
			id: "usr_1",
			email: "ada@example.com",
			name: "ada",
			organizationId: null,
		});
		expect(m.ensureUserOrg).toHaveBeenCalledWith(env, "usr_1");
		expect(m.addDomainForUser).toHaveBeenCalledWith(env, "usr_1", "org_1", "example.com", {
			enableRouting: true,
			enableSending: true,
		});
		expect(m.ensureEmailRoutingRuleToWorker).toHaveBeenCalledWith(env, "zone_1", "ada@example.com");
		expect(mock.inserts[1].values).toMatchObject({
			id: "mbx_1",
			userId: "usr_1",
			organizationId: "org_1",
			domainId: "dom_1",
			localPart: "ada",
		});
	});

	it("deletes the user when domain provisioning fails", async () => {
		mock.queueSelect([]);
		m.addDomainForUser.mockRejectedValue(new Error("boom"));
		expect(await registerFirstRunUser(env, firstRunInput)).toEqual({
			ok: false,
			error: "domain_setup_failed",
		});
		expect(mock.deletes).toHaveLength(1);
	});

	it("deletes the user when routing-rule provisioning fails", async () => {
		mock.queueSelect([]);
		m.addDomainForUser.mockResolvedValue({ domain: { id: "dom_1", zoneId: "zone_1" } });
		m.ensureEmailRoutingRuleToWorker.mockRejectedValue(new Error("routing down"));
		expect(await registerFirstRunUser(env, firstRunInput)).toEqual({
			ok: false,
			error: "domain_setup_failed",
		});
		expect(mock.deletes).toHaveLength(1);
		// Only the user insert happened; no mailbox was written.
		expect(mock.inserts).toHaveLength(1);
	});
});
