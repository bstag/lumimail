import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

vi.mock("@/lib/email/providers", () => ({ selectOutboundProvider: vi.fn() }));
vi.mock("@/lib/email/webhooks", () => ({ dispatchWebhooks: vi.fn() }));
vi.mock("@/lib/contacts/service", () => ({ upsertContactFromAddress: vi.fn() }));
vi.mock("@/lib/email/parse", () => ({ buildSnippet: vi.fn(() => "snippet") }));
vi.mock("@/lib/ids", () => ({ newId: vi.fn((p?: string) => (p ? `${p}_id` : "raw_id")) }));

import {
	processOutboundDeadLetter,
	processOutboundQueue,
	resolveSenderAuthorization,
	sendEmail,
	validateSenderDomain,
} from "@/lib/email/send";
import { selectOutboundProvider } from "@/lib/email/providers";
import { OutboundProviderError } from "@/lib/email/providers/types";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { upsertContactFromAddress } from "@/lib/contacts/service";

const selectProvider = vi.mocked(selectOutboundProvider);
const dispatch = vi.mocked(dispatchWebhooks);
const upsertContact = vi.mocked(upsertContactFromAddress);
const providerSend = vi.fn();
const queueSend = vi.fn();
const bucketPut = vi.fn();
const bucketGet = vi.fn();
const bucketDelete = vi.fn();

const env = {
	OUTBOUND_QUEUE: { send: queueSend },
	BUCKET: { put: bucketPut, get: bucketGet, delete: bucketDelete },
} as unknown as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
	providerSend.mockReset();
	queueSend.mockReset();
	queueSend.mockResolvedValue(undefined);
	bucketPut.mockReset();
	bucketGet.mockReset();
	bucketDelete.mockReset();
	bucketPut.mockResolvedValue(undefined);
	bucketDelete.mockResolvedValue(undefined);
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
	});

	it("returns true for an org user with a mailbox", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: "org_1" }])
			.queueSelect([{ id: "mb_1", localPart: "a", displayName: null }]);
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
	});

	it("uses the personal-user path when the user has no organization", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: null }])
			.queueSelect([{ id: "mb_1", localPart: "a", displayName: null }]);
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
	});

	it("treats a missing user row as a personal user", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([])
			.queueSelect([{ id: "mb_1", localPart: "a", displayName: null }]);
		expect(await validateSenderDomain(env, "u1", "a@example.com")).toBe(true);
	});
});

describe("resolveSenderAuthorization", () => {
	// The single authorization query returns the full mailbox identity row; the
	// previous second sender-context query (and its silent `input.from` fallback
	// for a mailbox that authorization had just proven) no longer exists (T-30).
	it("returns the mailbox identity row used to derive the canonical sender", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: "org_1" }])
			.queueSelect([{ id: "mb_1", localPart: "a", displayName: "Agent A" }]);
		expect(await resolveSenderAuthorization(env, "u1", "a@example.com")).toEqual({
			mailboxId: "mb_1",
			organizationId: "org_1",
			localPart: "a",
			hostname: "example.com",
			displayName: "Agent A",
		});
	});

	it("performs no Cloudflare API work: authorization is pure DB (T-31)", async () => {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: null }])
			.queueSelect([{ id: "mb_1", localPart: "a", displayName: null }]);
		await resolveSenderAuthorization(env, "u1", "a@example.com");
		// Three DB reads (domain, user org, mailbox) and nothing else.
		expect(mock.db.select).toHaveBeenCalledTimes(3);
	});
});

describe("sendEmail producer", () => {
	function queueAuthorization(
		orgId: string | null = null,
		mailbox: Record<string, unknown> = { id: "mb_1", localPart: "a", displayName: null },
	) {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: orgId }])
			.queueSelect([mailbox]);
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
			text: "untrusted alternative",
			html: '<p onclick="bad()"><strong>formatted body</strong><script>secret()</script></p>',
		});

		expect(result).toEqual({ messageId: "msg_id", status: "queued" });
		expect(upsertContact).toHaveBeenCalledWith(env, { userId: "u1", address: "b@x.com", source: "outbound" });
		expect(mock.inserts).toHaveLength(3);
		expect(mock.inserts[0].values).toMatchObject({
			id: "msg_id",
			direction: "outbound",
			fromAddr: '"a" <a@example.com>',
			toAddr: "b@x.com",
			status: "queued",
			mailboxId: "mb_1",
			threadId: "thr_id",
		});
		expect(mock.inserts[1].values).toMatchObject({
			textBody: "formatted body",
			htmlBody: "<p><strong>formatted body</strong></p>",
		});
		expect(mock.inserts[2].values).toMatchObject({
			id: "job_id",
			status: "queued",
			payload: JSON.stringify({
				from: '"a" <a@example.com>',
				to: "b@x.com",
				subject: "Hi",
				html: "<p><strong>formatted body</strong></p>",
				text: "formatted body",
			}),
		});
		expect(queueSend).toHaveBeenCalledWith({ kind: "outbound", jobId: "job_id" });
		expect(providerSend).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("derives authorized reply headers and inherits the source thread", async () => {
		queueAuthorization("org_1");
		mock.queueSelect([{
			id: "msg_parent",
			threadId: "thr_existing",
			rfcMessageId: "<parent@example.com>",
			providerMessageId: "provider_123",
			referencesHeader: "<root@example.com>",
			fromAddr: "Sender <sender@example.com>",
			textBody: "Plain source",
			htmlBody: "<p><strong>Rich source</strong><script>bad()</script></p>",
		}]);

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Re: Hi",
			replyToMessageId: "msg_parent",
			text: "Authored <reply>",
			html: "<p>Authored &lt;reply&gt;<script>bad()</script></p>",
		});

		expect(mock.inserts[0].values).toMatchObject({
			threadId: "thr_existing",
			inReplyTo: "<parent@example.com>",
			referencesHeader: "<root@example.com> <parent@example.com>",
			replySourceMessageId: "msg_parent",
		});
		expect(JSON.parse((mock.inserts[2].values as { payload: string }).payload)).toMatchObject({
			text: expect.stringContaining("Authored <reply>"),
			html: expect.stringContaining("<strong>Rich source</strong>"),
			headers: {
				"In-Reply-To": "<parent@example.com>",
				References: "<root@example.com> <parent@example.com>",
			},
		});
		const body = mock.inserts[1].values as { textBody: string; htmlBody: string };
		expect(body.textBody).toContain("> Plain source");
		expect(body.htmlBody).toContain("Authored &lt;reply&gt;");
		expect(body.htmlBody).toContain("<blockquote><p><strong>Rich source</strong></p></blockquote>");
		expect(body.htmlBody).toContain("<p>Authored &lt;reply&gt;</p>");
		expect(body.htmlBody).not.toContain("<script");
	});

	it("returns an existing MCP acceptance without persisting or enqueueing again", async () => {
		queueAuthorization("org_1");
		mock.queueSelect([{ requestHash: "hash_1", messageId: "msg_existing", status: "sent" }]);
		await expect(sendEmail(env, {
			userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi",
			idempotency: { principalType: "mcp", principalId: "mcp_1", key: "request_0123456789", requestHash: "hash_1" },
		})).resolves.toEqual({ messageId: "msg_existing", status: "sent", replayed: true });
		expect(mock.inserts).toHaveLength(0);
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("rejects reuse of an MCP idempotency key for changed input", async () => {
		queueAuthorization("org_1");
		mock.queueSelect([{ requestHash: "hash_old", messageId: "msg_existing", status: "queued" }]);
		await expect(sendEmail(env, {
			userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Changed",
			idempotency: { principalType: "mcp", principalId: "mcp_1", key: "request_0123456789", requestHash: "hash_new" },
		})).rejects.toMatchObject({ name: "IdempotencyConflictError" });
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("batches MCP idempotency with message, body, and job persistence", async () => {
		queueAuthorization("org_1");
		mock.queueSelect([]);
		await sendEmail(env, {
			userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi",
			idempotency: {
				principalType: "mcp", principalId: "mcp_1", key: "request_0123456789", requestHash: "hash_1",
				audit: { organizationId: "org_1", actorUserId: "u1", requestId: "req_mcp" },
			},
		});
		expect(mock.inserts).toHaveLength(5);
		expect(mock.inserts[3].values).toMatchObject({
			principalType: "mcp", principalId: "mcp_1", idempotencyKey: "request_0123456789",
			requestHash: "hash_1", messageId: "msg_id", jobId: "job_id",
		});
		expect(mock.inserts[4].values).toMatchObject({
			action: "mcp.mutate", resourceType: "mcp_connection", resourceId: "mcp_1", requestId: "req_mcp",
		});
		expect(mock.db.batch).toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
	});

	it("turns a concurrent unique-key race into the winning acceptance", async () => {
		queueAuthorization("org_1");
		mock.queueSelect([]).queueSelect([{ requestHash: "hash_1", messageId: "msg_winner", status: "queued" }]);
		mock.db.batch.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));
		await expect(sendEmail(env, {
			userId: "u1", from: "a@example.com", to: "b@x.com", subject: "Hi",
			idempotency: { principalType: "mcp", principalId: "mcp_1", key: "request_0123456789", requestHash: "hash_1" },
		})).resolves.toEqual({ messageId: "msg_winner", status: "queued", replayed: true });
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("traces a persisted inbound RFC id through reply, queue, provider, and delivery state", async () => {
		queueAuthorization("org_1");
		const inboundRfcId = "<trace-inbound@example.com>";
		mock.queueSelect([{
			id: "msg_inbound",
			threadId: "thr_trace",
			rfcMessageId: inboundRfcId,
			providerMessageId: inboundRfcId,
			referencesHeader: null,
			fromAddr: "Sender <sender@example.com>",
			textBody: "Inbound body",
			htmlBody: "<p>Inbound body</p>",
		}]);

		const accepted = await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "sender@example.com",
			subject: "Re: traced message",
			replyToMessageId: "msg_inbound",
			text: "Reply body",
		});

		const persistedMessage = mock.inserts[0].values as Record<string, unknown>;
		const persistedJob = mock.inserts[2].values as { id: string; payload: string };
		expect(accepted.messageId).toBe("msg_id");
		expect(persistedMessage).toMatchObject({
			id: "msg_id",
			threadId: "thr_trace",
			replySourceMessageId: "msg_inbound",
			inReplyTo: inboundRfcId,
		});
		expect(queueSend).toHaveBeenCalledWith({ kind: "outbound", jobId: persistedJob.id });
		expect(JSON.parse(persistedJob.payload).headers).toEqual({
			"In-Reply-To": inboundRfcId,
			References: inboundRfcId,
		});

		mock.queueSelect([{
			id: persistedJob.id,
			userId: "u1",
			messageId: accepted.messageId,
			status: "processing",
			deliveryToken: "delivery_trace",
			payload: persistedJob.payload,
		}]);
		providerSend.mockResolvedValue({ providerMessageId: "<trace-outbound@example.com>" });

		expect(
			await processOutboundQueue(
				env,
				{ kind: "outbound", jobId: persistedJob.id },
				"delivery_trace",
			),
		).toEqual({ action: "ack" });
		expect(providerSend).toHaveBeenCalledWith(expect.objectContaining({
			headers: { "In-Reply-To": inboundRfcId, References: inboundRfcId },
		}));
		expect(mock.updates.at(-1)?.set).toMatchObject({
			status: "sent",
			providerMessageId: "<trace-outbound@example.com>",
		});
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.outbound", {
			messageId: accepted.messageId,
			providerMessageId: "<trace-outbound@example.com>",
			to: "sender@example.com",
		});
	});

	it("rejects a reply source outside the selected accessible mailbox", async () => {
		queueAuthorization("org_1");
		mock.queueSelect([]);

		await expect(sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Re: Hi",
			replyToMessageId: "msg_other_tenant",
		})).rejects.toMatchObject({ name: "ReplySourceNotAllowedError" });
		expect(mock.inserts).toHaveLength(0);
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("assigns a fresh thread when an authorized legacy source has no thread id", async () => {
		queueAuthorization("org_1");
		mock.queueSelect([{
			id: "msg_parent",
			threadId: null,
			rfcMessageId: "<parent@example.com>",
			providerMessageId: null,
			referencesHeader: null,
		}]);

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Re: Hi",
			replyToMessageId: "msg_parent",
		});

		expect(mock.inserts[0].values).toMatchObject({ threadId: "thr_id" });
	});

	it("stores the canonical formatted sender in the immutable job snapshot", async () => {
		queueAuthorization(null, { id: "mb_1", localPart: "a", displayName: "Agent A" });

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
		queueAuthorization(null, { id: "mb_1", localPart: "a", displayName: null });

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			mailboxId: "mb_1",
		});

		expect(mock.inserts[0].values).toMatchObject({ fromAddr: '"a" <a@example.com>' });
	});

	it("keeps the requested sender when it does not reduce to the mailbox address", async () => {
		// A bare `<a@example.com>` authorizes (the address parser unwraps the
		// angle brackets) but the display-name parser leaves it intact, so it does
		// not compare equal to `a@example.com` and is stored verbatim.
		queueAuthorization("org_1");

		await sendEmail(env, {
			userId: "u1",
			from: "<a@example.com>",
			to: "b@x.com",
			subject: "Hi",
			mailboxId: "mb_1",
		});

		expect(mock.inserts[0].values).toMatchObject({ fromAddr: "<a@example.com>" });
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

	it("stores attachment bytes before persisting metadata and enqueueing", async () => {
		queueAuthorization();
		const content = new TextEncoder().encode("exact bytes").buffer;

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			attachments: [{ filename: "../report.txt", contentType: "text/plain", content }],
		});

		expect(bucketPut).toHaveBeenCalledWith(
			"attachments/u1/msg_id/att_id",
			content,
			{ httpMetadata: { contentType: "text/plain" } },
		);
		expect(mock.inserts).toHaveLength(4);
		expect(mock.inserts[3].values).toEqual([expect.objectContaining({
			messageId: "msg_id",
			filename: "report.txt",
			size: 11,
			r2Key: "attachments/u1/msg_id/att_id",
		})]);
		const payload = JSON.parse((mock.inserts[2].values as { payload: string }).payload);
		expect(payload.attachments).toEqual([{
			id: "att_id",
			filename: "report.txt",
			contentType: "text/plain",
			size: 11,
			r2Key: "attachments/u1/msg_id/att_id",
			disposition: "attachment",
		}]);
		expect(payload.attachments[0]).not.toHaveProperty("content");
	});

	it("stores inline content IDs in durable attachment snapshots", async () => {
		queueAuthorization();
		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Chart",
			html: '<p><img src="cid:chart_1" alt="Chart"></p>',
			attachments: [{
				filename: "chart.png",
				contentType: "image/png",
				content: new Uint8Array([1]).buffer,
				disposition: "inline",
				contentId: "chart_1",
			}],
		});
		const payload = JSON.parse((mock.inserts[2].values as { payload: string }).payload);
		expect(payload.attachments[0]).toMatchObject({
			disposition: "inline",
			contentId: "chart_1",
		});
		expect(mock.inserts[3].values).toEqual([expect.objectContaining({
			disposition: "inline",
			contentId: "chart_1",
		})]);
	});

	it("removes stored objects when D1 persistence fails", async () => {
		queueAuthorization();
		mock.db.batch.mockRejectedValueOnce(new Error("D1 unavailable"));

		await expect(sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			attachments: [{
				filename: "report.txt",
				contentType: "text/plain",
				content: new TextEncoder().encode("x").buffer,
			}],
		})).rejects.toThrow("D1 unavailable");

		expect(bucketDelete).toHaveBeenCalledWith("attachments/u1/msg_id/att_id");
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("does not enqueue after a partial R2 upload failure", async () => {
		queueAuthorization();
		bucketPut.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("R2 unavailable"));

		await expect(sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			attachments: [
				{ filename: "one.txt", contentType: "text/plain", content: new ArrayBuffer(1) },
				{ filename: "two.txt", contentType: "text/plain", content: new ArrayBuffer(1) },
			],
		})).rejects.toThrow("R2 unavailable");

		// One bulk delete covers every attempted key (both share the mocked id).
		expect(bucketDelete).toHaveBeenCalledTimes(1);
		expect(bucketDelete).toHaveBeenCalledWith([
			"attachments/u1/msg_id/att_id",
			"attachments/u1/msg_id/att_id",
		]);
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("does not hide the original failure when R2 cleanup also fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		queueAuthorization();
		mock.db.batch.mockRejectedValueOnce(new Error("D1 unavailable"));
		bucketDelete.mockRejectedValue(new Error("cleanup unavailable"));

		await expect(sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			attachments: [{
				filename: "one.txt",
				contentType: "text/plain",
				content: new ArrayBuffer(1),
			}],
		})).rejects.toThrow("D1 unavailable");
		expect(consoleError).toHaveBeenCalledWith("Failed to clean up attachment objects");
		consoleError.mockRestore();
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

describe("automatic reply marking", () => {
	/** Mirrors the sender-authorization select sequence sendEmail performs. */
	function queueAuthorization(orgId: string | null = null) {
		mock
			.queueSelect([activeDomain])
			.queueSelect([{ organizationId: orgId }])
			.queueSelect([{ id: "mb_1", localPart: "a", displayName: "Agent A" }]);
	}

	it("applies the fixed auto-reply headers when the snapshot is flagged", async () => {
		mock.queueSelect([{
			...storedJob,
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Away",
				text: "OOO",
				autoReply: true,
			}),
		}]);
		providerSend.mockResolvedValue({ providerMessageId: "provider_1" });

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");

		// The headers come from a constant in code, never from the stored payload.
		expect(providerSend.mock.calls[0][0].headers).toMatchObject({
			"Auto-Submitted": "auto-replied",
			"X-Auto-Response-Suppress": "All",
		});
	});

	it("merges auto-reply headers with threading headers", async () => {
		mock.queueSelect([{
			...storedJob,
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Away",
				text: "OOO",
				autoReply: true,
				headers: { "In-Reply-To": "<p@x>", References: "<p@x>" },
			}),
		}]);
		providerSend.mockResolvedValue({ providerMessageId: "provider_1" });

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");

		expect(providerSend.mock.calls[0][0].headers).toMatchObject({
			"In-Reply-To": "<p@x>",
			"Auto-Submitted": "auto-replied",
		});
	});

	it("sends no headers for an ordinary message", async () => {
		mock.queueSelect([storedJob]);
		providerSend.mockResolvedValue({ providerMessageId: "provider_1" });

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");

		expect(providerSend.mock.calls[0][0].headers).toBeUndefined();
	});

	it("rejects a stored payload whose autoReply flag is not a boolean", async () => {
		mock.queueSelect([{
			...storedJob,
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Hi",
				text: "Body",
				autoReply: "yes",
			}),
		}]);

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");

		// An invalid snapshot must fail the job rather than be sent.
		expect(providerSend).not.toHaveBeenCalled();
	});

	it("records the flag on the snapshot when sending an automatic reply", async () => {
		queueAuthorization();

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Away",
			text: "OOO",
			mailboxId: "mb_1",
			autoReply: true,
		});

		expect(JSON.parse((mock.inserts[2].values as { payload: string }).payload)).toMatchObject({
			autoReply: true,
		});
	});

	it("omits the flag for an ordinary message", async () => {
		queueAuthorization();

		await sendEmail(env, {
			userId: "u1",
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi",
			text: "Body",
			mailboxId: "mb_1",
		});

		expect(JSON.parse((mock.inserts[2].values as { payload: string }).payload).autoReply)
			.toBeUndefined();
	});
});

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

	it("sends persisted RFC reply headers from the immutable snapshot", async () => {
		mock.queueSelect([{
			...storedJob,
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Re: Hi",
				text: "Body",
				headers: {
					"In-Reply-To": "<parent@example.com>",
					References: "<root@example.com> <parent@example.com>",
				},
			}),
		}]);
		providerSend.mockResolvedValue({ providerMessageId: "<sent@example.com>" });

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");

		expect(providerSend).toHaveBeenCalledWith(expect.objectContaining({
			headers: {
				"In-Reply-To": "<parent@example.com>",
				References: "<root@example.com> <parent@example.com>",
			},
		}));
		expect(mock.updates[2].set).toEqual({
			status: "sent",
			providerMessageId: "<sent@example.com>",
			rfcMessageId: "<sent@example.com>",
		});
	});

	it("rejects a stored snapshot with malformed reply headers", async () => {
		mock.queueSelect([{
			...storedJob,
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Re: Hi",
				headers: null,
			}),
		}]).queueSelect([storedJob]);

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");

		expect(providerSend).not.toHaveBeenCalled();
		expect(mock.updates).toHaveLength(3);
		expect(mock.updates[1].set).toMatchObject({
			status: "failed",
			error: "Stored outbound payload is invalid",
		});
	});

	it("loads exact attachment bytes from R2 before provider delivery", async () => {
		const content = new TextEncoder().encode("exact").buffer;
		mock.queueSelect([{
			...storedJob,
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Hi",
				attachments: [{
					id: "att_1",
					filename: "report.txt",
					contentType: "text/plain",
					size: 5,
					r2Key: "attachments/u1/msg_1/att_1",
				}],
			}),
		}]);
		bucketGet.mockResolvedValue({ size: 5, arrayBuffer: async () => content });
		providerSend.mockResolvedValue({ providerMessageId: "provider_1" });

		await expect(processOutboundQueue(
			env,
			{ kind: "outbound", jobId: "job_1" },
			"delivery_1",
		)).resolves.toEqual({ action: "ack" });

		expect(providerSend).toHaveBeenCalledWith(expect.objectContaining({
			attachments: [{
				filename: "report.txt",
				contentType: "text/plain",
				size: 5,
				content,
				disposition: "attachment",
			}],
		}));
	});

	it("restores inline metadata when loading queued attachment bytes", async () => {
		const content = new Uint8Array([1]).buffer;
		mock.queueSelect([{
			...storedJob,
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Chart",
				html: '<img src="cid:chart_1">',
				attachments: [{
					id: "att_1",
					filename: "chart.png",
					contentType: "image/png",
					size: 1,
					r2Key: "attachments/u1/msg_1/att_1",
					disposition: "inline",
					contentId: "chart_1",
				}],
			}),
		}]);
		bucketGet.mockResolvedValue({ size: 1, arrayBuffer: async () => content });
		providerSend.mockResolvedValue({ providerMessageId: "provider_1" });
		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");
		expect(providerSend).toHaveBeenCalledWith(expect.objectContaining({
			attachments: [expect.objectContaining({
				disposition: "inline",
				contentId: "chart_1",
			})],
		}));
	});

	it("fails without provider delivery when an attachment object is missing", async () => {
		mock
			.queueSelect([{
				...storedJob,
				payload: JSON.stringify({
					from: "a@example.com",
					to: "b@x.com",
					subject: "Hi",
					attachments: [{
						id: "att_1",
						filename: "report.txt",
						contentType: "text/plain",
						size: 5,
						r2Key: "attachments/u1/msg_1/att_1",
					}],
				}),
			}])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);
		bucketGet.mockResolvedValue(null);

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");

		expect(providerSend).not.toHaveBeenCalled();
		expect(dispatch).toHaveBeenCalledWith(env, "u1", "message.failed", {
			messageId: "msg_1",
			error: "Stored outbound attachment is missing or corrupt",
		});
	});

	it("retries when R2 is temporarily unavailable", async () => {
		mock.queueSelect([{
			...storedJob,
			payload: JSON.stringify({
				from: "a@example.com",
				to: "b@x.com",
				subject: "Hi",
				attachments: [{
					id: "att_1",
					filename: "report.txt",
					contentType: "text/plain",
					size: 5,
					r2Key: "attachments/u1/msg_1/att_1",
				}],
			}),
		}]);
		bucketGet.mockRejectedValue(new Error("R2 unavailable"));

		await expect(processOutboundQueue(
			env,
			{ kind: "outbound", jobId: "job_1" },
			"delivery_1",
		)).resolves.toEqual({ action: "retry", delaySeconds: 30 });
		expect(providerSend).not.toHaveBeenCalled();
		expect(mock.updates.at(-1)?.set).toMatchObject({
			status: "queued",
			error: "Attachment storage unavailable",
		});
	});

	it("fails a snapshot that references a non-canonical R2 key", async () => {
		mock
			.queueSelect([{
				...storedJob,
				payload: JSON.stringify({
					from: "a@example.com",
					to: "b@x.com",
					subject: "Hi",
					attachments: [{
						id: "att_1",
						filename: "report.txt",
						contentType: "text/plain",
						size: 5,
						r2Key: "attachments/another-user/secret",
					}],
				}),
			}])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");
		expect(bucketGet).not.toHaveBeenCalled();
		expect(providerSend).not.toHaveBeenCalled();
	});

	it("fails when the retrieved attachment bytes do not match stored size", async () => {
		mock
			.queueSelect([{
				...storedJob,
				payload: JSON.stringify({
					from: "a@example.com",
					to: "b@x.com",
					subject: "Hi",
					attachments: [{
						id: "att_1",
						filename: "report.txt",
						contentType: "text/plain",
						size: 5,
						r2Key: "attachments/u1/msg_1/att_1",
					}],
				}),
			}])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);
		bucketGet.mockResolvedValue({ size: 5, arrayBuffer: async () => new ArrayBuffer(4) });

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");
		expect(providerSend).not.toHaveBeenCalled();
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
		JSON.stringify({ from: "a@example.com", to: "b@x.com", subject: "Hi", attachments: [null] }),
		JSON.stringify({
			from: "a@example.com", to: "b@x.com", subject: "Hi",
			attachments: [{
				id: "a", filename: "a", contentType: "image/png", size: 1,
				r2Key: "x", disposition: "remote",
			}],
		}),
		JSON.stringify({
			from: "a@example.com", to: "b@x.com", subject: "Hi",
			attachments: [{
				id: "a", filename: "a", contentType: "image/png", size: 1,
				r2Key: "x", disposition: "inline", contentId: 42,
			}],
		}),
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

	it("truncates stored provider diagnostics at 500 characters", async () => {
		mock
			.queueSelect([storedJob])
			.queueSelect([{ id: "job_1", userId: "u1", messageId: "msg_1" }]);
		providerSend.mockRejectedValue(
			new OutboundProviderError("x".repeat(600), { retryable: false }),
		);

		await processOutboundQueue(env, { kind: "outbound", jobId: "job_1" }, "delivery_1");
		const stored = (mock.updates[1].set as { error: string }).error;
		expect(stored).toBe("x".repeat(500));
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
