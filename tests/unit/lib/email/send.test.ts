import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

vi.mock("@/lib/email/providers", () => ({ selectOutboundProvider: vi.fn() }));
vi.mock("@/lib/email/webhooks", () => ({ dispatchWebhooks: vi.fn() }));
vi.mock("@/lib/cloudflare-api", () => ({ ensureEmailRoutingRuleToWorker: vi.fn() }));
vi.mock("@/lib/contacts/service", () => ({ upsertContactFromAddress: vi.fn() }));
vi.mock("@/lib/email/parse", () => ({ buildSnippet: vi.fn(() => "snippet") }));
vi.mock("@/lib/ids", () => ({ newId: vi.fn((p?: string) => (p ? `${p}_id` : "raw_id")) }));

import { processOutboundQueue, sendEmail, validateSenderDomain } from "@/lib/email/send";
import { selectOutboundProvider } from "@/lib/email/providers";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { upsertContactFromAddress } from "@/lib/contacts/service";

const selectProvider = vi.mocked(selectOutboundProvider);
const dispatch = vi.mocked(dispatchWebhooks);
const ensureRule = vi.mocked(ensureEmailRoutingRuleToWorker);
const upsertContact = vi.mocked(upsertContactFromAddress);
const providerSend = vi.fn();

const env = {} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
	providerSend.mockReset();
	selectProvider.mockReturnValue({ id: "test", send: providerSend } as unknown as ReturnType<typeof selectOutboundProvider>);
});

const activeDomain = { id: "dom_1", hostname: "example.com", status: "active", zoneId: "zone_1" };

describe("validateSenderDomain", () => {
	it("returns false for an unparseable from address", async () => {
		expect(await validateSenderDomain(env, "u1", "garbage")).toBe(false);
	});

	it("returns false when no active domain matches", async () => {
		mock.queueSelect([]); // domain
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(false);
	});

	it("returns false when no mailbox matches (org user path)", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ organizationId: "org_1" }]) // getUserOrgId
			.queueSelect([]); // mailbox -> none
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(false);
		expect(ensureRule).not.toHaveBeenCalled();
	});

	it("ensures the routing rule and returns true for an org user with a mailbox", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ organizationId: "org_1" }]) // getUserOrgId
			.queueSelect([{ id: "mb_1" }]); // mailbox
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
		expect(ensureRule).toHaveBeenCalledWith(env, "zone_1", "a@example.com");
	});

	it("uses the personal-user path when the user has no organization", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([{ organizationId: null }]) // getUserOrgId -> null
			.queueSelect([{ id: "mb_1" }]); // mailbox
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
		expect(ensureRule).toHaveBeenCalledWith(env, "zone_1", "a@example.com");
	});

	it("treats a missing user row as a personal user (org id null)", async () => {
		mock
			.queueSelect([activeDomain]) // domain
			.queueSelect([]) // getUserOrgId -> no user row
			.queueSelect([{ id: "mb_1" }]); // mailbox
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
	});
});

describe("sendEmail", () => {
	function queueValidation(orgId: string | null = null) {
		mock
			.queueSelect([activeDomain]) // validateSenderDomain: domain
			.queueSelect([{ organizationId: orgId }]) // getUserOrgId
			.queueSelect([{ id: "mb_1" }]); // mailbox
	}

	it("throws when the sender is not an allowed mailbox", async () => {
		mock.queueSelect([]); // domain lookup fails -> validate false
		await expect(
			sendEmail(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi" }),
		).rejects.toThrow(/not an active mailbox/);
		expect(mock.inserts).toHaveLength(0);
	});

	it("sends successfully without a mailboxId and uses the raw from address", async () => {
		queueValidation();
		providerSend.mockResolvedValue({ providerMessageId: "prov-1" });

		const result = await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			text: "body",
			html: "<p>body</p>",
		});

		expect(result).toEqual({ messageId: "msg_id" });
		expect(upsertContact).toHaveBeenCalledWith(env, { userId: "u1", address: "b@x.com", source: "outbound" });

		expect(mock.inserts).toHaveLength(3); // messages, messageBodies, outboundJobs
		expect(mock.inserts[0].values).toMatchObject({
			id: "msg_id",
			direction: "outbound",
			fromAddr: "a@example.com",
			toAddr: "b@x.com",
			subject: "Hi",
			snippet: "snippet",
			status: "queued",
			mailboxId: "mb_1",
		});
		expect(mock.inserts[2].values).toMatchObject({ id: "job_id", status: "queued" });

		expect(providerSend).toHaveBeenCalledWith({
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			html: "<p>body</p>",
			text: "body",
		});

		expect(mock.updates).toHaveLength(2);
		expect(mock.updates[0].set).toEqual({ status: "sent", providerMessageId: "prov-1" });
		expect(mock.updates[1].set).toMatchObject({ status: "sent" });

		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.outbound", {
			messageId: "msg_id",
			providerMessageId: "prov-1",
			to: "b@x.com",
		});
	});

	it("formats the sender address from the mailbox when it matches the requested from", async () => {
		queueValidation();
		mock
			.queueSelect([{ organizationId: null }]) // getUserOrgId inside getFormattedSenderAddress
			.queueSelect([{ localPart: "a", displayName: "Agent A", hostname: "example.com" }]); // mailbox join
		providerSend.mockResolvedValue({ providerMessageId: "prov-2" });

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			mailboxId: "mb_1",
		});

		expect(mock.inserts[0].values).toMatchObject({ fromAddr: '"Agent A" <a@example.com>' });
		expect(providerSend.mock.calls[0][0].from).toBe('"Agent A" <a@example.com>');
	});

	it("falls back to the mailbox localPart when the matched mailbox has no displayName", async () => {
		queueValidation();
		mock
			.queueSelect([{ organizationId: null }]) // getUserOrgId inside getFormattedSenderAddress
			.queueSelect([{ localPart: "a", displayName: null, hostname: "example.com" }]); // a@example.com, no display name
		providerSend.mockResolvedValue({ providerMessageId: "prov-3" });

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			mailboxId: "mb_1",
		});

		// displayName null -> formatEmailAddress falls back to localPart "a"
		expect(mock.inserts[0].values).toMatchObject({ fromAddr: '"a" <a@example.com>' });
		expect(providerSend.mock.calls[0][0].from).toBe('"a" <a@example.com>');
	});

	it("keeps the requested from when the mailbox row is missing", async () => {
		queueValidation();
		mock
			.queueSelect([{ organizationId: null }]) // getUserOrgId
			.queueSelect([]); // mailbox join -> none
		providerSend.mockResolvedValue({ providerMessageId: "p" });

		await sendEmail(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi", mailboxId: "mb_1" });
		expect(mock.inserts[0].values).toMatchObject({ fromAddr: "a@example.com" });
	});

	it("keeps the requested from when the requested address differs from the mailbox address", async () => {
		queueValidation("org_9");
		mock
			.queueSelect([{ organizationId: "org_9" }]) // getUserOrgId inside getFormattedSenderAddress
			.queueSelect([{ localPart: "other", displayName: null, hostname: "example.com" }]); // other@example.com
		providerSend.mockResolvedValue({ providerMessageId: "p" });

		await sendEmail(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi", mailboxId: "mb_1" });
		expect(mock.inserts[0].values).toMatchObject({ fromAddr: "a@example.com" });
	});

	it("marks the message failed and dispatches message.failed when the provider throws an Error", async () => {
		queueValidation();
		providerSend.mockRejectedValue(new Error("smtp down"));

		await expect(
			sendEmail(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi" }),
		).rejects.toThrow("smtp down");

		expect(mock.updates).toHaveLength(2);
		expect(mock.updates[0].set).toEqual({ status: "failed" });
		expect(mock.updates[1].set).toMatchObject({ status: "failed", error: "smtp down" });
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_id",
			error: "smtp down",
		});
	});

	it("uses a generic error message when the provider throws a non-Error", async () => {
		queueValidation();
		providerSend.mockRejectedValue("oops");

		await expect(
			sendEmail(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi" }),
		).rejects.toBe("oops");

		expect(mock.updates[1].set).toMatchObject({ status: "failed", error: "Send failed" });
	});
});

describe("processOutboundQueue", () => {
	it("delegates to sendEmail", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: null }])
			.queueSelect([{ id: "mb_1" }]);
		providerSend.mockResolvedValue({ providerMessageId: "p" });

		await expect(
			processOutboundQueue(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi" }),
		).resolves.toBeUndefined();
		expect(providerSend).toHaveBeenCalledTimes(1);
	});
});
