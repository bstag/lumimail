import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	hashToken: vi.fn(),
	send: vi.fn(),
	rateLimit: vi.fn(),
	nextId: 0,
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/auth/invitation", () => ({ hashInvitationToken: h.hashToken }));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix}_${++h.nextId}` }));
vi.mock("@/lib/email/providers", () => ({ selectOutboundProvider: () => ({ send: h.send }) }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
	return { ...actual, rateLimitCheck: h.rateLimit };
});

import {
	createOrganizationInvitation,
	listOrganizationInvitations,
	resendOrganizationInvitation,
} from "@/lib/organization-invitations";
import { RateLimitUnavailableError } from "@/lib/rate-limit";

const now = new Date("2026-08-12T22:00:00.000Z");
const env = {
	PUBLIC_APP_URL: "https://mail.example.com",
	PASSWORD_RESET_FROM: "noreply@example.com",
} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
	h.hashToken.mockReset().mockResolvedValue("hashed-token");
	h.send.mockReset().mockResolvedValue({ providerMessageId: "provider_1" });
	h.rateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 0 });
	h.nextId = 0;
});

describe("organization invitation lifecycle", () => {
	it("lists at most 50 scoped records with server-derived lifecycle states", async () => {
		mock.queueSelect([
			{ id: "accepted", expiresAt: new Date(now.getTime() + 1_000), acceptedAt: now, deliveryStatus: "sent" },
			{ id: "expired", expiresAt: new Date(now.getTime() - 1_000), acceptedAt: null, deliveryStatus: "failed" },
			{ id: "pending", expiresAt: new Date(now.getTime() + 1_000), acceptedAt: null, deliveryStatus: "not_sent" },
		]);
		expect(await listOrganizationInvitations(env, "org_1", now)).toEqual([
			expect.objectContaining({ id: "accepted", status: "accepted" }),
			expect.objectContaining({ id: "expired", status: "expired" }),
			expect.objectContaining({ id: "pending", status: "pending" }),
		]);
		const builder = mock.db.select.mock.results[0].value;
		expect(builder.limit).toHaveBeenCalledWith(50);
	});

	it("creates, stores, and sends an identity-bound invitation before reporting sent", async () => {
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Example Org" }]).queueSelect([]);
		const result = await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "admin", now,
		});
		expect(result).toEqual({ status: "created", inviteId: "inv_2", token: "tok_1", deliveryStatus: "sent" });
		expect(mock.inserts[0].values).toMatchObject({
			id: "inv_2", organizationId: "org_1", email: "new@example.com", role: "admin",
			token: "hashed-token", deliveryStatus: "sending", lastDeliveryAttemptAt: now,
		});
		expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
			from: "noreply@example.com", to: "new@example.com",
			subject: "You're invited to Example Org on Picket",
			text: expect.stringContaining("https://mail.example.com/register?token=tok_1"),
			html: expect.stringContaining("https://mail.example.com/register?token=tok_1"),
		}));
		expect(mock.updates.at(-1)?.set).toMatchObject({ deliveryStatus: "sent", lastDeliveredAt: now });
	});

	it("keeps a usable manual fallback and records only failed when delivery rejects", async () => {
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "<Example>" }]).queueSelect([]);
		h.send.mockRejectedValueOnce(new Error("provider secret detail"));
		const result = await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member", now,
		});
		expect(result).toEqual({ status: "created", inviteId: "inv_2", token: "tok_1", deliveryStatus: "failed" });
		expect(mock.updates.at(-1)?.set).toEqual({ deliveryStatus: "failed" });
		expect(JSON.stringify(mock.updates.map((update) => update.set))).not.toContain("provider secret detail");
		expect(h.send.mock.calls[0][0].html).toContain("&lt;Example&gt;");
	});

	it("rotates and extends a stored invite while deriving its recipient and role", async () => {
		const invite = {
			id: "inv_1", email: "stored@example.com", role: "member", organizationName: "Example Org",
			acceptedAt: null, lastDeliveryAttemptAt: new Date(now.getTime() - 61_000),
		};
		mock.queueSelect([invite]).queueSelect([invite]);
		const result = await resendOrganizationInvitation(env, { organizationId: "org_1", inviteId: "inv_1", now });
		expect(result).toEqual({ status: "resent", inviteId: "inv_1", token: "tok_1", deliveryStatus: "sent" });
		expect(mock.updates[0].set).toMatchObject({ token: "hashed-token", deliveryStatus: "sending" });
		expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ to: "stored@example.com" }));
	});

	it("rejects unknown, accepted, and cooling-down resend targets before sending", async () => {
		mock.queueSelect([]);
		expect(await resendOrganizationInvitation(env, { organizationId: "org_1", inviteId: "missing", now })).toEqual({ status: "not-found" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([{ id: "inv_1", acceptedAt: now, lastDeliveryAttemptAt: null }]);
		expect(await resendOrganizationInvitation(env, { organizationId: "org_1", inviteId: "inv_1", now })).toEqual({ status: "accepted" });

		mock = createDbMock(); h.db = mock.db;
		h.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });
		mock.queueSelect([{ id: "inv_1", acceptedAt: null, lastDeliveryAttemptAt: new Date(now.getTime() - 30_000) }]);
		expect(await resendOrganizationInvitation(env, { organizationId: "org_1", inviteId: "inv_1", now })).toEqual({ status: "rate-limited" });
		expect(h.send).not.toHaveBeenCalled();
	});

	it("returns bounded create conflicts and fails closed when organization or limiter storage is absent", async () => {
		mock.queueSelect([{ id: "member_1" }]);
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "member@example.com", role: "member", now,
		})).toEqual({ status: "already-member" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([]).queueSelect([{ id: "user_1" }]);
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "user@example.com", role: "member", now,
		})).toEqual({ status: "email-registered" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([]).queueSelect([]).queueSelect([]);
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member", now,
		})).toEqual({ status: "unavailable" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org" }]).queueSelect([]);
		h.rateLimit.mockRejectedValueOnce(new RateLimitUnavailableError());
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member", now,
		})).toEqual({ status: "unavailable" });
	});

	it("refreshes an existing invite and rejects a create inside the shared cooldown", async () => {
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org" }]).queueSelect([{ id: "inv_existing" }]).queueSelect([{ id: "inv_existing" }]);
		const result = await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "admin", now,
		});
		expect(result).toMatchObject({ status: "created", inviteId: "inv_existing" });
		expect(mock.updates[0].set).toMatchObject({ role: "admin", token: "hashed-token", deliveryStatus: "sending" });
		expect(mock.inserts).toHaveLength(0);

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org" }]).queueSelect([]);
		h.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member", now,
		})).toEqual({ status: "rate-limited" });
		expect(h.send).toHaveBeenCalledTimes(1);
	});

	it("sends no unusable link when acceptance wins a refresh or resend race", async () => {
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org" }]).queueSelect([{ id: "inv_existing" }]).queueSelect([]);
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member", now,
		})).toEqual({ status: "unavailable" });
		expect(h.send).not.toHaveBeenCalled();

		mock = createDbMock(); h.db = mock.db;
		const invite = { id: "inv_1", email: "stored@example.com", role: "member", organizationName: "Org", acceptedAt: null, lastDeliveryAttemptAt: null };
		mock.queueSelect([invite]).queueSelect([]);
		expect(await resendOrganizationInvitation(env, {
			organizationId: "org_1", inviteId: "inv_1", now,
		})).toEqual({ status: "accepted" });
		expect(h.send).not.toHaveBeenCalled();
	});

	it("uses safe fallback status for sender/link misconfiguration and indeterminate status writes", async () => {
		for (const badEnv of [
			{ ...env, PASSWORD_RESET_FROM: "" },
			{ ...env, PUBLIC_APP_URL: undefined },
			{ ...env, PUBLIC_APP_URL: "not a url" },
			{ ...env, PUBLIC_APP_URL: "http://mail.example.com" },
		] as CloudflareEnv[]) {
			mock = createDbMock(); h.db = mock.db;
			mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org" }]).queueSelect([]);
			expect(await createOrganizationInvitation(badEnv, {
				organizationId: "org_1", email: "new@example.com", role: "member", now,
			})).toMatchObject({ status: "created", deliveryStatus: "failed" });
		}

		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org\r\nInjected" }]).queueSelect([]);
		mock.db.update.mockImplementationOnce(() => { throw new Error("status unavailable"); });
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member", now,
		})).toMatchObject({ status: "created", deliveryStatus: "sending" });
		expect(h.send).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "You're invited to Org Injected on Picket" }));

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org" }]).queueSelect([]);
		h.send.mockRejectedValueOnce(new Error("down"));
		mock.db.update.mockImplementationOnce(() => { throw new Error("status unavailable"); });
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member", now,
		})).toMatchObject({ status: "created", deliveryStatus: "sending" });
		expect(error).toHaveBeenCalledTimes(2);
		error.mockRestore();
	});

	it("fails closed on resend limiter storage errors and propagates unexpected limiter failures", async () => {
		const invite = { id: "inv_1", email: "stored@example.com", role: "member", organizationName: "Org", acceptedAt: null, lastDeliveryAttemptAt: null };
		mock.queueSelect([invite]);
		h.rateLimit.mockRejectedValueOnce(new RateLimitUnavailableError());
		expect(await resendOrganizationInvitation(env, { organizationId: "org_1", inviteId: "inv_1", now })).toEqual({ status: "unavailable" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([invite]);
		const failure = new Error("unexpected");
		h.rateLimit.mockRejectedValueOnce(failure);
		await expect(resendOrganizationInvitation(env, { organizationId: "org_1", inviteId: "inv_1", now })).rejects.toBe(failure);
	});

	it("uses the runtime clock defaults and propagates unexpected create limiter failures", async () => {
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org" }]).queueSelect([]);
		expect(await createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member",
		})).toMatchObject({ status: "created" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([{ id: "inv_1", email: "stored@example.com", role: "member", organizationName: "Org", acceptedAt: null, lastDeliveryAttemptAt: null }]).queueSelect([{ id: "inv_1" }]);
		expect(await resendOrganizationInvitation(env, {
			organizationId: "org_1", inviteId: "inv_1",
		})).toMatchObject({ status: "resent" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([]).queueSelect([]).queueSelect([{ name: "Org" }]).queueSelect([]);
		const failure = new Error("unexpected create limiter failure");
		h.rateLimit.mockRejectedValueOnce(failure);
		await expect(createOrganizationInvitation(env, {
			organizationId: "org_1", email: "new@example.com", role: "member", now,
		})).rejects.toBe(failure);
	});
});
