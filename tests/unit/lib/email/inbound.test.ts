import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";
import { messages } from "@/db/schema";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

vi.mock("@/lib/email/routing", () => ({ resolveInboundTargets: vi.fn() }));
vi.mock("@/lib/email/parse", () => ({ parseRawMime: vi.fn(), buildSnippet: vi.fn(() => "snippet") }));
vi.mock("@/lib/email/webhooks", () => ({ dispatchWebhooks: vi.fn() }));
vi.mock("@/lib/contacts/service", () => ({ upsertContactFromAddress: vi.fn(), getMessageContactNames: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/ids", () => ({ newId: vi.fn((p?: string) => (p ? `${p}_id` : "raw_id")) }));

import {
	getMessageWithBody,
	processInboundMessage,
	storeRawToR2,
} from "@/lib/email/inbound";
import { resolveInboundTargets as resolveInboundTargetsImport } from "@/lib/email/routing";
import { parseRawMime as parseRawMimeImport } from "@/lib/email/parse";
import { dispatchWebhooks as dispatchWebhooksImport } from "@/lib/email/webhooks";
import { upsertContactFromAddress as upsertImport, getMessageContactNames as contactNamesImport } from "@/lib/contacts/service";
import { sendEmail as sendEmailImport } from "@/lib/email/send";
import { newId as newIdImport } from "@/lib/ids";
import type { RoutingDecision, ResolvedMailbox } from "@/lib/email/routing";
import type { ParsedEmail } from "@/lib/email/parse";
import { INBOUND_ATTACHMENT_OMISSION_MESSAGE } from "@/lib/email/inbound-attachments";

const resolveInboundTargets = vi.mocked(resolveInboundTargetsImport);
const parseRawMime = vi.mocked(parseRawMimeImport);
const dispatchWebhooks = vi.mocked(dispatchWebhooksImport);
const upsertContactFromAddress = vi.mocked(upsertImport);
const getMessageContactNames = vi.mocked(contactNamesImport);
const sendEmail = vi.mocked(sendEmailImport);
const newId = vi.mocked(newIdImport);

let mock: DbMock;

const mailbox: ResolvedMailbox = {
	mailboxId: "mb_1",
	userId: "u1",
	organizationId: "org_1",
	domainId: "dom_1",
	localPart: "a",
	hostname: "example.com",
	displayName: "Agent A",
};

const parsed: ParsedEmail = {
	subject: "Hello",
	text: "text body",
	html: "<p>html</p>",
	messageId: "<mid@x>",
	inReplyTo: null,
	references: null,
	fromAddr: "sender@other.com",
	toAddr: "a@example.com",
	attachments: [],
};

const storeDecisions: RoutingDecision[] = [{ action: "store", mailbox }];

function makeR2() {
	return { arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) };
}

function makeEnv(bucketGet: unknown): CloudflareEnv {
	return {
		BUCKET: {
			get: vi.fn(async () => bucketGet),
			put: vi.fn(async () => undefined),
			delete: vi.fn(async () => undefined),
		},
	} as unknown as CloudflareEnv;
}

let warnSpy: ReturnType<typeof vi.fn>;
let infoSpy: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
	parseRawMime.mockResolvedValue(parsed);
	warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

const payload = { from: "sender@other.com", to: "a@example.com", rawR2Key: "inbound/k.eml" };

describe("processInboundMessage", () => {
	it("warns and returns when there are no routing decisions", async () => {
		resolveInboundTargets.mockResolvedValue([]);
		const env = makeEnv(makeR2());
		await processInboundMessage(env, payload);
		expect(warnSpy).toHaveBeenCalledWith("No routing for inbound address: a@example.com");
		expect(env.BUCKET.get).not.toHaveBeenCalled();
	});

	it("logs reject decisions and returns when there are no mailbox targets", async () => {
		resolveInboundTargets.mockResolvedValue([
			{ action: "reject" },
			{ action: "forward", forwardTo: "ext@x.com" },
		] as RoutingDecision[]);
		const env = makeEnv(makeR2());
		await processInboundMessage(env, payload);
		expect(warnSpy).toHaveBeenCalledWith("Rejected inbound: a@example.com");
		// Forwarding now happens at receive time in the Worker's email() handler, so
		// this consumer must neither act on nor log the forward decision. It also no
		// longer records the recipient address of a forward target.
		expect(infoSpy).not.toHaveBeenCalled();
		expect(env.BUCKET.get).not.toHaveBeenCalled();
	});

	it("ignores a store decision without a mailbox and a forward decision without forwardTo", async () => {
		resolveInboundTargets.mockResolvedValue([
			{ action: "store" }, // no mailbox -> filtered out
			{ action: "forward" }, // no forwardTo -> no log
		] as RoutingDecision[]);
		const env = makeEnv(makeR2());
		await processInboundMessage(env, payload);
		expect(infoSpy).not.toHaveBeenCalled();
		expect(env.BUCKET.get).not.toHaveBeenCalled();
	});

	it("deletes the raw object and clears its reference once storage succeeds", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		const env = makeEnv(makeR2());
		mock.queueSelect([]).queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);

		// The reference is cleared before the object is removed, so no row can ever
		// name an object that no longer exists.
		expect(mock.updates.at(-1)?.set).toEqual({ rawR2Key: null });
		expect(env.BUCKET.delete).toHaveBeenCalledWith("inbound/k.eml");
	});

	it("keeps the raw object when nothing stored the message", async () => {
		resolveInboundTargets.mockResolvedValue([{ action: "reject" }] as RoutingDecision[]);
		const env = makeEnv(makeR2());

		await processInboundMessage(env, payload);

		// Unstored raw is retained for the diagnostic window and removed by the sweep.
		expect(env.BUCKET.delete).not.toHaveBeenCalled();
	});

	it("still succeeds when the raw object cannot be deleted", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		const env = makeEnv(makeR2());
		(env.BUCKET.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("r2 down"));
		mock.queueSelect([]).queueSelect([{ enabled: false }]);

		await expect(processInboundMessage(env, payload)).resolves.toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(
			"Raw inbound object could not be deleted",
			{ key: "inbound/k.eml" },
		);
	});

	it("errors and returns when the R2 object is missing", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		const env = makeEnv(null); // BUCKET.get -> null
		// vacation responder lookup not reached
		await processInboundMessage(env, payload);
		expect(errorSpy).toHaveBeenCalledWith("Missing R2 object: inbound/k.eml");
		expect(mock.inserts).toHaveLength(0);
	});

	it("delivers a stored message: contact, message, body, filters (none), webhook, vacation", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		const env = makeEnv(makeR2());
		mock
			.queueSelect([]) // applyMessageFilters: no filters
			.queueSelect([{ enabled: false }]); // vacation responder disabled

		await processInboundMessage(env, payload);

		expect(upsertContactFromAddress).toHaveBeenCalledWith(env, {
			userId: "u1",
			address: "sender@other.com",
			source: "inbound",
		});

		expect(mock.inserts).toHaveLength(2); // messages, messageBodies
		expect(mock.inserts[0].values).toMatchObject({
			id: "msg_id",
			userId: "u1",
			organizationId: "org_1",
			mailboxId: "mb_1",
			direction: "inbound",
			providerMessageId: "<mid@x>",
			fromAddr: "sender@other.com",
			subject: "Hello",
			status: "received",
			rfcMessageId: "<mid@x>",
			inReplyTo: null,
			referencesHeader: null,
			threadId: expect.stringMatching(/^thr_[a-f0-9]{32}$/),
			attachmentStatus: "none",
			attachmentError: null,
		});
		// toAddr: parsed.toAddr address == mailbox address -> uses mailbox header
		expect(mock.inserts[0].values).toMatchObject({ toAddr: '"Agent A" <a@example.com>' });
		expect(mock.inserts[1].values).toMatchObject({
			messageId: "msg_id",
			textBody: "text body",
			htmlBody: "<p>html</p>",
			rawR2Key: "inbound/k.eml",
		});

		expect(dispatchWebhooks).toHaveBeenCalledWith(env, "u1", "message.inbound", {
			messageId: "msg_id",
			from: "sender@other.com",
			to: '"Agent A" <a@example.com>',
			subject: "Hello",
		});
		// vacation disabled -> no send
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("inherits the thread of a parent found inside the target mailbox", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({
			...parsed,
			messageId: "<child@x>",
			inReplyTo: "<parent@x>",
			references: "<root@x> <parent@x>",
		});
		const env = makeEnv(makeR2());
		mock
			.queueSelect([{ rfcMessageId: "<parent@x>", providerMessageId: null, threadId: "thr_existing" }])
			.queueSelect([])
			.queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);

		expect(mock.inserts[0].values).toMatchObject({
			rfcMessageId: "<child@x>",
			inReplyTo: "<parent@x>",
			referencesHeader: "<root@x> <parent@x>",
			threadId: "thr_existing",
		});
	});

	it("creates a mailbox-scoped fallback thread when RFC metadata is absent", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({
			...parsed,
			messageId: null,
			inReplyTo: null,
			references: null,
		});
		const env = makeEnv(makeR2());
		mock.queueSelect([]).queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);

		expect(mock.inserts[0].values).toMatchObject({
			rfcMessageId: null,
			threadId: "thr_id",
		});
	});

	it("does not inherit a thread when reply identities are absent from this mailbox", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({
			...parsed,
			messageId: "<child@x>",
			inReplyTo: "<missing@x>",
			references: "<root@x>",
		});
		const env = makeEnv(makeR2());
		mock.queueSelect([]).queueSelect([]).queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);

		expect(mock.inserts[0].values).toMatchObject({
			threadId: expect.stringMatching(/^thr_[a-f0-9]{32}$/),
		});
	});

	it("can inherit a legacy parent stored only as providerMessageId", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({
			...parsed,
			messageId: "<child@x>",
			inReplyTo: "<legacy-parent@x>",
			references: null,
		});
		const env = makeEnv(makeR2());
		mock
			.queueSelect([{
				rfcMessageId: null,
				providerMessageId: "<legacy-parent@x>",
				threadId: "thr_legacy",
			}])
			.queueSelect([])
			.queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);

		expect(mock.inserts[0].values).toMatchObject({ threadId: "thr_legacy" });
	});

	it("stores exact attachment bytes before atomically batching message metadata", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		const bytes = new Uint8Array([0, 10, 128, 255]);
		parseRawMime.mockResolvedValue({
			...parsed,
			attachments: [{
				filename: "report.bin",
				contentType: "application/octet-stream",
				disposition: "attachment",
				contentId: null,
				content: bytes.buffer,
			}],
		});
		const env = makeEnv(makeR2());
		mock.queueSelect([]).queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);

		expect(env.BUCKET.put).toHaveBeenCalledWith(
			"attachments/u1/msg_id/att_id",
			bytes.buffer,
			{ httpMetadata: { contentType: "application/octet-stream" } },
		);
		expect(mock.inserts).toHaveLength(3);
		expect(mock.inserts[0].values).toMatchObject({
			attachmentStatus: "stored",
			attachmentError: null,
		});
		expect(mock.inserts[2].values).toEqual([expect.objectContaining({
			id: "att_id",
			messageId: "msg_id",
			filename: "report.bin",
			contentType: "application/octet-stream",
			size: 4,
			r2Key: "attachments/u1/msg_id/att_id",
		})]);
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(env.BUCKET.put).mock.invocationCallOrder[0],
		).toBeLessThan(mock.db.batch.mock.invocationCallOrder[0]);
	});

	it("stores a truthful omission status without writing partial attachment objects", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({
			...parsed,
			attachments: Array.from({ length: 51 }, () => ({
				filename: "x",
				contentType: "text/plain",
				disposition: "attachment" as const,
				contentId: null,
				content: new ArrayBuffer(0),
			})),
		});
		const env = makeEnv(makeR2());
		mock.queueSelect([]).queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);

		expect(env.BUCKET.put).not.toHaveBeenCalled();
		expect(mock.inserts).toHaveLength(2);
		expect(mock.inserts[0].values).toMatchObject({
			attachmentStatus: "omitted",
			attachmentError: INBOUND_ATTACHMENT_OMISSION_MESSAGE,
		});
	});

	it("removes written objects and rethrows when the D1 batch fails", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({
			...parsed,
			attachments: [{
				filename: "one.txt",
				contentType: "text/plain",
				disposition: "attachment",
				contentId: null,
				content: new Uint8Array([1]).buffer,
			}],
		});
		const env = makeEnv(makeR2());
		mock.db.batch.mockRejectedValueOnce(new Error("d1 unavailable"));

		await expect(processInboundMessage(env, payload)).rejects.toThrow("d1 unavailable");
		expect(env.BUCKET.delete).toHaveBeenCalledWith(
			"attachments/u1/msg_id/att_id",
		);
		expect(dispatchWebhooks).not.toHaveBeenCalled();
	});

	it("preserves the original failure when attachment cleanup also fails", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({
			...parsed,
			attachments: [{
				filename: "one.txt",
				contentType: "text/plain",
				disposition: "attachment",
				contentId: null,
				content: new Uint8Array([1]).buffer,
			}],
		});
		const env = makeEnv(makeR2());
		mock.db.batch.mockRejectedValueOnce(new Error("d1 unavailable"));
		vi.mocked(env.BUCKET.delete).mockRejectedValueOnce(new Error("cleanup unavailable"));

		await expect(processInboundMessage(env, payload)).rejects.toThrow("d1 unavailable");
		expect(errorSpy).toHaveBeenCalledWith(
			"Failed to clean up inbound attachment objects",
		);
	});

	it("rethrows a D1 failure without cleanup when the message has no attachments", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		const env = makeEnv(makeR2());
		mock.db.batch.mockRejectedValueOnce(new Error("d1 unavailable"));

		await expect(processInboundMessage(env, payload)).rejects.toThrow("d1 unavailable");
		expect(env.BUCKET.delete).not.toHaveBeenCalled();
	});

	it("removes attempted objects and rethrows when an R2 write fails", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({
			...parsed,
			attachments: [
				{
					filename: "one.txt",
					contentType: "text/plain",
					disposition: "attachment",
					contentId: null,
					content: new Uint8Array([1]).buffer,
				},
				{
					filename: "two.txt",
					contentType: "text/plain",
					disposition: "attachment",
					contentId: null,
					content: new Uint8Array([2]).buffer,
				},
			],
		});
		newId
			.mockImplementationOnce(() => "msg_unique")
			.mockImplementationOnce(() => "att_one")
			.mockImplementationOnce(() => "att_two");
		const env = makeEnv(makeR2());
		vi.mocked(env.BUCKET.put)
			.mockResolvedValueOnce({} as R2Object)
			.mockRejectedValueOnce(new Error("r2 unavailable"));

		await expect(processInboundMessage(env, payload)).rejects.toThrow("r2 unavailable");
		expect(env.BUCKET.delete).toHaveBeenCalledWith([
			"attachments/u1/msg_unique/att_one",
			"attachments/u1/msg_unique/att_two",
		]);
		expect(mock.db.batch).not.toHaveBeenCalled();
	});

	it("falls back to the localPart when the mailbox has no displayName", async () => {
		const mbNoName = { ...mailbox, displayName: null };
		resolveInboundTargets.mockResolvedValue([{ action: "store", mailbox: mbNoName }] as RoutingDecision[]);
		const env = makeEnv(makeR2());
		mock.queueSelect([]).queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);
		// displayName null -> formatEmailAddress uses localPart "a"
		expect(mock.inserts[0].values).toMatchObject({ toAddr: '"a" <a@example.com>' });
	});

	it("uses parsed.toAddr when it differs from the mailbox address", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({ ...parsed, toAddr: "different@elsewhere.com" });
		const env = makeEnv(makeR2());
		mock.queueSelect([]).queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);
		expect(mock.inserts[0].values).toMatchObject({ toAddr: "different@elsewhere.com" });
	});

	it("falls back to payload.from when parsed.fromAddr is null", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({ ...parsed, fromAddr: null });
		const env = makeEnv(makeR2());
		mock.queueSelect([]).queueSelect([{ enabled: false }]);

		await processInboundMessage(env, payload);
		expect(mock.inserts[0].values).toMatchObject({ fromAddr: "sender@other.com" });
	});
});

describe("processInboundMessage filters", () => {
	const baseEnv = () => makeEnv(makeR2());

	function singleStore() {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
	}

	/**
	 * Successful processing always clears `message_bodies.raw_r2_key` (F63), so
	 * "the filter changed nothing" must be asserted against the messages table
	 * rather than against every update the consumer performs.
	 */
	function messageUpdates() {
		return mock.updates.filter((update) => update.table === messages);
	}

	it("skips disabled filters", async () => {
		singleStore();
		mock
			.queueSelect([{ enabled: false, fromContains: "sender" }])
			.queueSelect([{ enabled: false }]); // vacation
		await processInboundMessage(baseEnv(), payload);
		expect(messageUpdates()).toHaveLength(0);
	});

	it("does not act when the filter does not match", async () => {
		singleStore();
		mock
			.queueSelect([{ enabled: true, fromContains: "nomatch", actionStar: true }])
			.queueSelect([{ enabled: false }]);
		await processInboundMessage(baseEnv(), payload);
		expect(messageUpdates()).toHaveLength(0);
	});

	it("applies star/read/trash and a label for a matching filter", async () => {
		singleStore();
		mock
			.queueSelect([
				{
					enabled: true,
					fromContains: "sender",
					toContains: "example.com",
					subjectContains: "Hello",
					hasWords: "Hello",
					actionStar: true,
					actionMarkRead: true,
					actionMoveToTrash: true,
					actionLabelId: "lbl_1",
				},
			])
			.queueSelect([{ enabled: false }]);

		await processInboundMessage(baseEnv(), payload);

		expect(messageUpdates()).toHaveLength(1);
		expect(mock.updates[0].set).toEqual({ starred: true, read: true, status: "trash" });
		// label insert
		expect(mock.inserts).toContainEqual(
			expect.objectContaining({ values: { messageId: "msg_id", labelId: "lbl_1" } }),
		);
	});

	it("applies archive status and updates when only archive is set", async () => {
		singleStore();
		mock
			.queueSelect([{ enabled: true, actionArchive: true }])
			.queueSelect([{ enabled: false }]);
		await processInboundMessage(baseEnv(), payload);
		expect(mock.updates[0].set).toEqual({ status: "archived" });
	});

	it("matches via hasWords against the subject when fromAddr does not contain it", async () => {
		singleStore();
		mock
			.queueSelect([{ enabled: true, hasWords: "Hello", actionMarkRead: true }])
			.queueSelect([{ enabled: false }]);
		await processInboundMessage(baseEnv(), payload);
		expect(mock.updates[0].set).toEqual({ read: true });
	});

	it("matches via hasWords against fromAddr when the subject does not contain it", async () => {
		singleStore();
		// subject "Hello" does not include "sender"; fromAddr "sender@other.com" does
		mock
			.queueSelect([{ enabled: true, hasWords: "sender", actionMarkRead: true }])
			.queueSelect([{ enabled: false }]);
		await processInboundMessage(baseEnv(), payload);
		expect(mock.updates[0].set).toEqual({ read: true });
	});

	it("evaluates subjectContains and hasWords against an empty string when the subject is null", async () => {
		singleStore();
		parseRawMime.mockResolvedValue({ ...parsed, subject: null });
		// subject null -> (subject ?? "") used for both subjectContains and hasWords.
		// subjectContains "Hello" no longer matches the empty subject, so the filter is skipped.
		mock
			.queueSelect([{ enabled: true, subjectContains: "Hello", hasWords: "Hello", actionMarkRead: true }])
			.queueSelect([{ enabled: false }]);
		await processInboundMessage(baseEnv(), payload);
		expect(messageUpdates()).toHaveLength(0);
	});

	it("does not update when a matching filter has no field actions but inserts the label", async () => {
		singleStore();
		mock
			.queueSelect([{ enabled: true, actionLabelId: "lbl_2" }])
			.queueSelect([{ enabled: false }]);
		await processInboundMessage(baseEnv(), payload);
		expect(messageUpdates()).toHaveLength(0);
		expect(mock.inserts).toContainEqual(
			expect.objectContaining({ values: { messageId: "msg_id", labelId: "lbl_2" } }),
		);
	});
});

describe("processInboundMessage vacation responder", () => {
	function singleStore() {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
	}
	const env = () => makeEnv(makeR2());

	it("skips when fromAddr is a noreply address", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({ ...parsed, fromAddr: "noreply@other.com" });
		mock.queueSelect([]); // filters only; vacation short-circuits before its select
		await processInboundMessage(env(), payload);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("skips when fromAddr is a no-reply address", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({ ...parsed, fromAddr: "no-reply@other.com" });
		mock.queueSelect([]);
		await processInboundMessage(env(), payload);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("skips when there is no responder row", async () => {
		singleStore();
		mock.queueSelect([]).queueSelect([]); // filters, then no responder
		await processInboundMessage(env(), payload);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("skips when now is before the start date", async () => {
		singleStore();
		const future = new Date(Date.now() + 86_400_000);
		mock
			.queueSelect([])
			.queueSelect([{ enabled: true, startDate: future, endDate: null, subject: "Away", body: "OOO" }]);
		await processInboundMessage(env(), payload);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("skips when now is after the end date", async () => {
		singleStore();
		const past = new Date(Date.now() - 86_400_000);
		mock
			.queueSelect([])
			.queueSelect([{ enabled: true, startDate: null, endDate: past, subject: "Away", body: "OOO" }]);
		await processInboundMessage(env(), payload);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("sends a vacation reply when active", async () => {
		singleStore();
		mock
			.queueSelect([])
			.queueSelect([{ enabled: true, startDate: null, endDate: null, subject: "Away", body: "OOO" }]);
		sendEmail.mockResolvedValue({ messageId: "msg_x", status: "queued" });

		await processInboundMessage(env(), payload);

		expect(sendEmail).toHaveBeenCalledWith(expect.anything(), {
			userId: "u1",
			from: '"Agent A" <a@example.com>',
			to: "sender@other.com",
			subject: "Re: Hello — Away",
			text: "OOO",
		});
	});

	it("swallows errors thrown by the vacation send", async () => {
		singleStore();
		mock
			.queueSelect([])
			.queueSelect([{ enabled: true, startDate: null, endDate: null, subject: "Away", body: "OOO" }]);
		sendEmail.mockRejectedValue(new Error("send failed"));

		await expect(processInboundMessage(env(), payload)).resolves.toBeUndefined();
	});

	it("uses an empty subject in the reply when the parsed subject is null", async () => {
		resolveInboundTargets.mockResolvedValue(storeDecisions);
		parseRawMime.mockResolvedValue({ ...parsed, subject: null });
		mock
			.queueSelect([])
			.queueSelect([{ enabled: true, startDate: null, endDate: null, subject: "Away", body: "OOO" }]);
		sendEmail.mockResolvedValue({ messageId: "x", status: "queued" });

		await processInboundMessage(env(), payload);
		expect(sendEmail).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ subject: "Re:  — Away" }),
		);
	});
});

describe("processInboundMessage multiple mailbox targets", () => {
	it("delivers to each mailbox target", async () => {
		const mb2 = { ...mailbox, mailboxId: "mb_2", userId: "u2", localPart: "b" };
		resolveInboundTargets.mockResolvedValue([
			{ action: "store", mailbox },
			{ action: "store", mailbox: mb2 },
		] as RoutingDecision[]);
		// per-mailbox: filters select + vacation select, ordered by delivery loop
		mock
			.queueSelect([]) // mb1 filters
			.queueSelect([{ enabled: false }]) // mb1 vacation
			.queueSelect([]) // mb2 filters
			.queueSelect([{ enabled: false }]); // mb2 vacation
		await processInboundMessage(makeEnv(makeR2()), payload);
		const deliveries = mock.inserts.filter(
			(i) => (i.values as { direction?: string }).direction === "inbound",
		);
		expect(deliveries).toHaveLength(2);
		expect(new Set(deliveries.map(
			(delivery) => (delivery.values as { threadId: string }).threadId,
		)).size).toBe(2);
	});

	it("creates independent attachment objects for every mailbox delivery", async () => {
		const mb2 = { ...mailbox, mailboxId: "mb_2", userId: "u2", localPart: "b" };
		resolveInboundTargets.mockResolvedValue([
			{ action: "store", mailbox },
			{ action: "store", mailbox: mb2 },
		] as RoutingDecision[]);
		parseRawMime.mockResolvedValue({
			...parsed,
			attachments: [{
				filename: "shared.txt",
				contentType: "text/plain",
				disposition: "attachment",
				contentId: null,
				content: new Uint8Array([7]).buffer,
			}],
		});
		newId
			.mockImplementationOnce(() => "msg_1")
			.mockImplementationOnce(() => "att_1")
			.mockImplementationOnce(() => "body_1")
			.mockImplementationOnce(() => "msg_2")
			.mockImplementationOnce(() => "att_2")
			.mockImplementationOnce(() => "body_2");
		mock
			.queueSelect([])
			.queueSelect([{ enabled: false }])
			.queueSelect([])
			.queueSelect([{ enabled: false }]);
		const env = makeEnv(makeR2());

		await processInboundMessage(env, payload);

		expect(env.BUCKET.put).toHaveBeenNthCalledWith(
			1,
			"attachments/u1/msg_1/att_1",
			expect.any(ArrayBuffer),
			expect.any(Object),
		);
		expect(env.BUCKET.put).toHaveBeenNthCalledWith(
			2,
			"attachments/u2/msg_2/att_2",
			expect.any(ArrayBuffer),
			expect.any(Object),
		);
	});
});

describe("storeRawToR2", () => {
	it("puts the raw stream and returns the generated key", async () => {
		const put = vi.fn(async () => {});
		const env = { BUCKET: { put } } as unknown as CloudflareEnv;
		const stream = new Response("raw-bytes").body as ReadableStream<Uint8Array>;

		const key = await storeRawToR2(env, "f@x.com", "t@y.com", stream);

		expect(key).toMatch(/^inbound\/\d+-raw_id\.eml$/);
		expect(put).toHaveBeenCalledTimes(1);
		const [putKey, , opts] = put.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>];
		expect(putKey).toBe(key);
		expect(opts).toEqual({
			httpMetadata: { contentType: "message/rfc822" },
			customMetadata: { from: "f@x.com", to: "t@y.com" },
		});
	});
});

describe("getMessageWithBody", () => {
	const env = {} as CloudflareEnv;

	it("returns null when the message is missing", async () => {
		mock.queueSelect([]);
		expect(await getMessageWithBody(env, "u1", null, "msg_1")).toBeNull();
	});

	it("returns null when the message belongs to another user", async () => {
		mock.queueSelect([]);
		expect(await getMessageWithBody(env, "u1", "org_1", "msg_1")).toBeNull();
	});

	it("returns the message merged with contact names plus the body", async () => {
		mock
			.queueSelect([{ id: "msg_1", userId: "u1", fromAddr: "f@x.com", toAddr: "t@y.com" }])
			.queueSelect([{ id: "body_1", messageId: "msg_1", textBody: "t" }]);
		getMessageContactNames.mockResolvedValue({ fromContactName: "F", toContactName: "T" });

		const result = await getMessageWithBody(env, "u1", "org_1", "msg_1");
		expect(getMessageContactNames).toHaveBeenCalledWith(env, "u1", "f@x.com", "t@y.com");
		expect(result).toEqual({
			message: { id: "msg_1", userId: "u1", fromAddr: "f@x.com", toAddr: "t@y.com", fromContactName: "F", toContactName: "T" },
			body: { id: "body_1", messageId: "msg_1", textBody: "t" },
		});
	});

	it("supports an explicit mailbox constraint for bridge reads", async () => {
		mock
			.queueSelect([{ id: "msg_1", mailboxId: "mb1", fromAddr: "f@x.com", toAddr: "t@y.com" }])
			.queueSelect([]);
		getMessageContactNames.mockResolvedValue({ fromContactName: null, toContactName: null });

		const result = await getMessageWithBody(env, "u1", "org_1", "msg_1", "mb1");

		expect(result?.message).toMatchObject({ id: "msg_1", mailboxId: "mb1" });
	});
});
