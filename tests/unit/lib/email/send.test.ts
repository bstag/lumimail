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

import {
	processOutboundDeadLetter,
	processOutboundQueue,
	sendEmail,
	validateSenderDomain,
} from "@/lib/email/send";
import { selectOutboundProvider } from "@/lib/email/providers";
import { OutboundProviderError } from "@/lib/email/providers/types";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { upsertContactFromAddress } from "@/lib/contacts/service";

const selectProvider = vi.mocked(selectOutboundProvider);
const dispatch = vi.mocked(dispatchWebhooks);
const ensureRule = vi.mocked(ensureEmailRoutingRuleToWorker);
const upsertContact = vi.mocked(upsertContactFromAddress);
const providerSend = vi.fn();
const queueSend = vi.fn();

const env = {
	OUTBOUND_QUEUE: { send: queueSend },
} as unknown as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
	providerSend.mockReset();
	queueSend.mockReset();
	queueSend.mockResolvedValue(undefined);
	selectProvider.mockReturnValue({ id: "test", send: providerSend } as unknown as ReturnType<typeof selectOutboundProvider>);
});

const activeDomain = { id: "dom_1", hostname: "example.com", status: "active", zoneId: "zone_1" };

describe("validateSenderDomain", () => {
	it("returns false for an unparseable from address", async () => {
		expect(await validateSenderDomain(env, "u1", "garbage")).toBe(false);
	});

	it("returns false when no active domain matches", async () => {
		mock.queueSelect([]);
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(false);
	});

	it("returns false when no mailbox matches (org user path)", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: "org_1" }])
			.queueSelect([]);
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(false);
		expect(ensureRule).not.toHaveBeenCalled();
	});

	it("ensures the routing rule and returns true for an org user with a mailbox", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: "org_1" }])
			.queueSelect([{ id: "mb_1" }]);
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
		expect(ensureRule).toHaveBeenCalledWith(env, "zone_1", "a@example.com");
	});

	it("uses the personal-user path when the user has no organization", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: null }])
			.queueSelect([{ id: "mb_1" }]);
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
		expect(ensureRule).toHaveBeenCalledWith(env, "zone_1", "a@example.com");
	});

	it("treats a missing user row as a personal user", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([])
			.queueSelect([{ id: "mb_1" }]);
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
	});
});

describe("sendEmail producer", () => {
	function queueAuthorization(orgId: string | null = null) {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: orgId }])
			.queueSelect([{ id: "mb_1" }]);
	}

	it("throws before persistence when the sender is not an allowed mailbox", async () => {
		mock.queueSelect([]);
		await expect(
			sendEmail(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi" }),
		).rejects.toThrow(/not an active mailbox/);
		expect(mock.inserts).toHaveLength(0);
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("persists and enqueues without calling the provider", async () => {
		queueAuthorization();

		const result = await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			text: "body",
			html: "<p>body</p>",
		});

		expect(result).toEqual({ messageId: "msg_id", status: "queued" });
		expect(upsertContact).toHaveBeenCalledWith(env, { userId: "u1", address: "b@x.com", source: "outbound" });
		expect(mock.inserts).toHaveLength(3);
		expect(mock.inserts[0].values).toMatchObject({
			id: "msg_id",
			direction: "outbound",
			fromAddr: "a@example.com",
			toAddr: "b@x.com",
			status: "queued",
			mailboxId: "mb_1",
		});
		expect(mock.inserts[2].values).toMatchObject({
			id: "job_id",
			status: "queued",
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Hi",
				html: "<p>body</p>",
				text: "body",
			}),
		});
		expect(queueSend).toHaveBeenCalledWith({ kind: "outbound", jobId: "job_id" });
		expect(providerSend).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("stores the canonical formatted sender in the immutable job snapshot", async () => {
		queueAuthorization();
		mock
			.queueSelect([{ organizationId: null }])
			.queueSelect([{ localPart: "a", displayName: "Agent A", hostname: "example.com" }]);

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			mailboxId: "mb_1",
		});

		expect(mock.inserts[0].values).toMatchObject({ fromAddr: '"Agent A" <a@example.com>' });
		expect(JSON.parse((mock.inserts[2].values as { payload: string }).payload)).toMatchObject({
			from: '"Agent A" <a@example.com>',
		});
	});

	it("uses the mailbox local part when the sender has no display name", async () => {
		queueAuthorization();
		mock
			.queueSelect([{ organizationId: null }])
			.queueSelect([{ localPart: "a", displayName: null, hostname: "example.com" }]);

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			mailboxId: "mb_1",
		});

		expect(mock.inserts[0].values).toMatchObject({ fromAddr: '"a" <a@example.com>' });
	});

	it("keeps the requested sender when the resolved mailbox address differs", async () => {
		queueAuthorization("org_1");
		mock
			.queueSelect([{ organizationId: "org_1" }])
			.queueSelect([{ localPart: "other", displayName: null, hostname: "example.com" }]);

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			mailboxId: "mb_1",
		});

		expect(mock.inserts[0].values).toMatchObject({ fromAddr: "a@example.com" });
	});

	it("marks the persisted rows failed when enqueueing fails", async () => {
		queueAuthorization();
		queueSend.mockRejectedValue(new Error("queue unavailable"));

		await expect(
			sendEmail(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi" }),
		).rejects.toThrow("queue unavailable");

		expect(providerSend).not.toHaveBeenCalled();
		expect(mock.updates).toHaveLength(2);
		expect(mock.updates[0].set).toMatchObject({ status: "failed", error: "Queue unavailable" });
		expect(mock.updates[1].set).toEqual({ status: "failed" });
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_id",
			error: "Queue unavailable",
		});
	});

	it("does not enqueue when the persistence batch fails", async () => {
		queueAuthorization();
		mock.db.batch.mockRejectedValueOnce(new Error("D1 unavailable"));

		await expect(
			sendEmail(env, { userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi" }),
		).rejects.toThrow("D1 unavailable");
		expect(queueSend).not.toHaveBeenCalled();
	});
});

const storedJob = {
	id: "job_1",
	userId: "u1",
	messageId: "msg_1",
	status: "processing",
	deliveryToken: "delivery_1",
	payload: JSON.stringify({
		from: "a@example.com",
		to: "b@x.com",
		subject: "Hi",
		text: "Body",
	}),
};

describe("processOutboundQueue consumer", () => {
	it("claims and sends the persisted job exactly once", async () => {
		mock.queueSelect([storedJob]);
		providerSend.mockResolvedValue({ providerMessageId: "provider_1" });

		const result = await processOutboundQueue(
			env,
			{ kind: "outbound", jobId: "job_1" },
			"delivery_1",
		);

		expect(result).toEqual({ action: "ack" });
		expect(providerSend).toHaveBeenCalledWith({
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			text: "Body",
		});
		expect(mock.updates).toHaveLength(3);
		expect(mock.updates[1].set).toMatchObject({ status: "sent" });
		expect(mock.updates[2].set).toEqual({ status: "sent", providerMessageId: "provider_1" });
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.outbound", {
			messageId: "msg_1",
			providerMessageId: "provider_1",
			to: "b@x.com",
		});
	});

	it.each(["sent", "failed"])("acknowledges an already %s job without sending", async (status) => {
		mock.queueSelect([]).queueSelect([{ ...storedJob, status }]);
		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_2"),
		).resolves.toEqual({ action: "ack" });
		expect(providerSend).not.toHaveBeenCalled();
	});

	it("acknowledges a duplicate delivery owned by another token", async () => {
		mock.queueSelect([]).queueSelect([{ ...storedJob, deliveryToken: "delivery_other" }]);
		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_2"),
		).resolves.toEqual({ action: "ack" });
		expect(providerSend).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("fails closed after an ambiguous crash with the same delivery token", async () => {
		mock
			.queueSelect([])
			.queueSelect([storedJob])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);

		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1"),
		).resolves.toEqual({ action: "ack" });
		expect(providerSend).not.toHaveBeenCalled();
		expect(mock.updates.at(-1)?.set).toEqual({ status: "failed" });
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_1",
			error: expect.stringContaining("unknown"),
		});
	});

	it("acknowledges a missing job without sending", async () => {
		mock.queueSelect([]).queueSelect([]);
		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "missing" }, "delivery_1"),
		).resolves.toEqual({ action: "ack" });
		expect(providerSend).not.toHaveBeenCalled();
	});

	it("fails a claimed job whose visible message was deleted", async () => {
		mock
			.queueSelect([{ ...storedJob, messageId: null }])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: null }]);
		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1"),
		).resolves.toEqual({ action: "ack" });
		expect(providerSend).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("returns a delayed retry for a classified transient provider failure", async () => {
		mock.queueSelect([storedJob]);
		providerSend.mockRejectedValue(
			new OutboundProviderError("Provider rate limited", { retryable: true, code: "E_RATE_LIMIT_EXCEEDED" }),
		);

		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1"),
		).resolves.toEqual({ action: "retry", delaySeconds: 30 });
		expect(mock.updates.at(-1)?.set).toMatchObject({
			status: "queued",
			deliveryToken: null,
			error: "E_RATE_LIMIT_EXCEEDED: Provider rate limited",
		});
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("marks a permanent provider failure and acknowledges it", async () => {
		mock
			.queueSelect([storedJob])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);
		providerSend.mockRejectedValue(
			new OutboundProviderError("Sender rejected", { retryable: false, code: "E_SENDER_NOT_VERIFIED" }),
		);

		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1"),
		).resolves.toEqual({ action: "ack" });
		expect(mock.updates.at(-1)?.set).toEqual({ status: "failed" });
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_1",
			error: "E_SENDER_NOT_VERIFIED: Sender rejected",
		});
	});

	it("treats corrupt stored payload as a terminal failure", async () => {
		mock
			.queueSelect([{ ...storedJob, payload: "{" }])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);

		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1"),
		).resolves.toEqual({ action: "ack" });
		expect(providerSend).not.toHaveBeenCalled();
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_1",
			error: "Stored outbound payload is invalid",
		});
	});

	it.each([
		"null",
		JSON.stringify("not an object"),
		JSON.stringify({}),
		JSON.stringify({ from: 1, to: "b@x.com", subject: "Hi" }),
		JSON.stringify({ from: "a@example.com", to: 1, subject: "Hi" }),
		JSON.stringify({ from: "a@example.com", to: "b@x.com", subject: 1 }),
		JSON.stringify({ from: "a@example.com", to: "b@x.com", subject: "Hi", html: 1 }),
		JSON.stringify({ from: "a@example.com", to: "b@x.com", subject: "Hi", text: 1 }),
	])("rejects a structurally invalid stored payload", async (invalidPayload) => {
		mock
			.queueSelect([{ ...storedJob, payload: invalidPayload }])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);

		await expect(
			processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1"),
		).resolves.toEqual({ action: "ack" });
		expect(providerSend).not.toHaveBeenCalled();
	});

	it("stores a bounded provider message when no provider code is available", async () => {
		mock
			.queueSelect([storedJob])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);
		providerSend.mockRejectedValue(
			new OutboundProviderError("Permanent provider failure", { retryable: false }),
		);

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_1",
			error: "Permanent provider failure",
		});
	});

	it("fails closed with a generic diagnostic for an unclassified provider error", async () => {
		mock
			.queueSelect([storedJob])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);
		providerSend.mockRejectedValue(new Error("response may contain sensitive detail"));

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_1",
			error: "Outbound provider failed",
		});
	});
});

describe("processOutboundDeadLetter", () => {
	it("marks an exhausted queued job failed", async () => {
		mock.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);
		await processOutboundDeadLetter(env, { kind: "outbound", jobId: "job_1" });
		expect(mock.updates.at(-1)?.set).toEqual({ status: "failed" });
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_1",
			error: "Outbound delivery retries exhausted",
		});
	});

	it("does not overwrite a sent or already failed job", async () => {
		mock.queueSelect([]);
		await processOutboundDeadLetter(env, { kind: "outbound", jobId: "job_1" });
		expect(dispatch).not.toHaveBeenCalled();
	});
});
