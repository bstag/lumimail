import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

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
import type { RoutingDecision, ResolvedMailbox } from "@/lib/email/routing";
import type { ParsedEmail } from "@/lib/email/parse";

const resolveInboundTargets = vi.mocked(resolveInboundTargetsImport);
const parseRawMime = vi.mocked(parseRawMimeImport);
const dispatchWebhooks = vi.mocked(dispatchWebhooksImport);
const upsertContactFromAddress = vi.mocked(upsertImport);
const getMessageContactNames = vi.mocked(contactNamesImport);
const sendEmail = vi.mocked(sendEmailImport);

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
	fromAddr: "sender@other.com",
	toAddr: "a@example.com",
};

const storeDecisions: RoutingDecision[] = [{ action: "store", mailbox }];

function makeR2() {
	return { arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) };
}

function makeEnv(bucketGet: unknown): CloudflareEnv {
	return { BUCKET: { get: vi.fn(async () => bucketGet) } } as unknown as CloudflareEnv;
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

	it("logs reject and forward decisions and returns when there are no mailbox targets", async () => {
		resolveInboundTargets.mockResolvedValue([
			{ action: "reject" },
			{ action: "forward", forwardTo: "ext@x.com" },
		] as RoutingDecision[]);
		const env = makeEnv(makeR2());
		await processInboundMessage(env, payload);
		expect(warnSpy).toHaveBeenCalledWith("Rejected inbound: a@example.com");
		expect(infoSpy).toHaveBeenCalledWith("Forward a@example.com -> ext@x.com");
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
			threadId: "<mid@x>",
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

	it("skips disabled filters", async () => {
		singleStore();
		mock
			.queueSelect([{ enabled: false, fromContains: "sender" }])
			.queueSelect([{ enabled: false }]); // vacation
		await processInboundMessage(baseEnv(), payload);
		expect(mock.updates).toHaveLength(0);
	});

	it("does not act when the filter does not match", async () => {
		singleStore();
		mock
			.queueSelect([{ enabled: true, fromContains: "nomatch", actionStar: true }])
			.queueSelect([{ enabled: false }]);
		await processInboundMessage(baseEnv(), payload);
		expect(mock.updates).toHaveLength(0);
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

		expect(mock.updates).toHaveLength(1);
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
		expect(mock.updates).toHaveLength(0);
	});

	it("does not update when a matching filter has no field actions but inserts the label", async () => {
		singleStore();
		mock
			.queueSelect([{ enabled: true, actionLabelId: "lbl_2" }])
			.queueSelect([{ enabled: false }]);
		await processInboundMessage(baseEnv(), payload);
		expect(mock.updates).toHaveLength(0);
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
		expect(mock.inserts.filter((i) => (i.values as { direction?: string }).direction === "inbound")).toHaveLength(2);
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
