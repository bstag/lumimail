import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	parse: vi.fn(),
	threading: vi.fn(),
	prepare: vi.fn(),
	newId: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/parse", () => ({ parseRawMime: h.parse, buildSnippet: () => "snippet" }));
vi.mock("@/lib/email/threading", () => ({ resolveInboundThreading: h.threading }));
vi.mock("@/lib/email/inbound-attachments", () => ({ prepareInboundAttachments: h.prepare }));
vi.mock("@/lib/ids", () => ({ newId: h.newId }));

import { persistExternalMessage } from "@/lib/email/external/import-message";

const account = {
	id: "exa_1", organizationId: "org_1", mailboxId: "mbx_1", ownerUserId: "usr_1",
	provider: "google" as const, retainOriginal: true,
};
const mailbox = {
	id: "mbx_1", userId: "usr_mailbox", organizationId: "org_1", localPart: "support",
	displayName: "Support", hostname: "example.com",
};
const change = {
	remoteMessageId: "remote_1", remoteThreadId: "thread_remote", remoteFolderKey: "inbox" as const,
	remoteRevision: "rev_1", removed: false, rawMime: new TextEncoder().encode("raw mime"),
};

describe("persistExternalMessage", () => {
	let mock: DbMock;
	let bucket: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		bucket = { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
		h.parse.mockResolvedValue({
			fromAddr: "sender@example.com", toAddr: "support@example.com", subject: "Hello",
			text: "Body", html: null, attachments: [], messageId: "<rfc@example.com>",
			inReplyTo: null, references: [],
		});
		h.threading.mockResolvedValue({
			rfcMessageId: "<rfc@example.com>", inReplyTo: null, referencesHeader: null, threadId: "thr_1",
		});
		h.prepare.mockReturnValue({ attachments: [], status: "none", error: null });
		let index = 0;
		h.newId.mockImplementation((prefix?: string) => `${prefix ?? "id"}_${++index}`);
	});

	it("atomically imports a normalized message, mapping, and retained exact original", async () => {
		mock.queueSelect([]);
		const result = await persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			account, mailbox, change, new Date("2026-08-15T12:00:00Z"));
		expect(result).toEqual({ status: "created", messageId: "msg_1" });
		expect(bucket.put).toHaveBeenCalledWith(
			expect.stringMatching(/^external-originals\/org_1\/exa_1\/exm_2\.eml$/),
			change.rawMime,
			expect.objectContaining({ httpMetadata: { contentType: "message/rfc822" } }),
		);
		expect(mock.inserts.map((insert) => insert.values)).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "msg_1", mailboxId: "mbx_1", direction: "inbound", status: "received" }),
			expect.objectContaining({ id: "exm_2", accountId: "exa_1", remoteMessageId: "remote_1", lumimailMessageId: "msg_1" }),
			expect.objectContaining({ accountId: "exa_1", remoteMessageId: "remote_1", size: 8 }),
		]));
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
	});

	it("deduplicates replay and records remote removal without deleting the local copy", async () => {
		mock.queueSelect([{ id: "exm_existing", lumimailMessageId: "msg_existing" }]);
		expect(await persistExternalMessage({} as CloudflareEnv, account, mailbox, change))
			.toEqual({ status: "existing", messageId: "msg_existing" });
		expect(h.parse).not.toHaveBeenCalled();
		expect(mock.updates.at(-1)?.set).toMatchObject({ remoteFolderKey: "inbox", removedAt: null });

		mock.queueSelect([{ id: "exm_existing", lumimailMessageId: "msg_existing" }]);
		expect(await persistExternalMessage({} as CloudflareEnv, account, mailbox, {
			...change, removed: true, rawMime: undefined,
		})).toEqual({ status: "removed", messageId: "msg_existing" });
		expect(mock.deletes).toEqual([]);
		expect((mock.updates.at(-1)?.set as any).removedAt).toBeInstanceOf(Date);
	});

	it("ignores a removal never imported and rejects a missing MIME payload", async () => {
		mock.queueSelect([]);
		expect(await persistExternalMessage({} as CloudflareEnv, account, mailbox, {
			...change, removed: true, rawMime: undefined,
		})).toEqual({ status: "ignored" });
		mock.queueSelect([]);
		await expect(persistExternalMessage({} as CloudflareEnv, account, mailbox, {
			...change, rawMime: undefined,
		})).rejects.toThrow("External message MIME is missing");
	});

	it("maps sent and archive folders and stores bounded attachments", async () => {
		h.prepare.mockReturnValue({
			attachments: [{ filename: "a.txt", contentType: "text/plain", size: 3, content: new Uint8Array([1, 2, 3]), disposition: "attachment", contentId: null }],
			status: "stored", error: null,
		});
		mock.queueSelect([]);
		expect(await persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			{ ...account, retainOriginal: false }, mailbox, { ...change, remoteFolderKey: "sent" }))
			.toMatchObject({ status: "created" });
		expect(mock.inserts.map((insert) => insert.values)).toEqual(expect.arrayContaining([
			expect.objectContaining({ direction: "outbound", status: "sent" }),
			expect.arrayContaining([expect.objectContaining({ filename: "a.txt", size: 3 })]),
		]));
		expect(bucket.put).toHaveBeenCalledWith(expect.stringContaining("attachments/"), expect.anything(), expect.anything());
	});

	it("reconciles a provider Sent item with the durable local outbound row", async () => {
		mock.queueSelect([]).queueSelect([{ id: "msg_outbound" }]);
		expect(await persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			account, mailbox, { ...change, remoteFolderKey: "sent" }))
			.toEqual({ status: "existing", messageId: "msg_outbound" });
		expect(mock.inserts.map((insert) => insert.values)).toEqual(expect.arrayContaining([
			expect.objectContaining({ accountId: "exa_1", remoteMessageId: "remote_1", lumimailMessageId: "msg_outbound" }),
			expect.objectContaining({ accountId: "exa_1", lumimailMessageId: "msg_outbound", size: 8 }),
		]));
		expect(mock.inserts.map((insert) => insert.values)).not.toEqual(expect.arrayContaining([
			expect.objectContaining({ direction: "outbound" }),
		]));
	});

	it("uses local RFC ancestors for imported threading and falls back when none match", async () => {
		h.threading.mockImplementationOnce(async (options: any) => {
			expect(options.fallbackThreadId()).toMatch(/^thr_/);
			expect(await options.findAncestor(["<missing@example.com>", "<parent@example.com>"]))
				.toEqual({ threadId: "thr_parent" });
			return { rfcMessageId: "<rfc@example.com>", inReplyTo: "<parent@example.com>", referencesHeader: "<parent@example.com>", threadId: "thr_parent" };
		});
		mock.queueSelect([]).queueSelect([{ rfcMessageId: null, providerMessageId: "<parent@example.com>", threadId: "thr_parent" }]);
		expect(await persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			{ ...account, retainOriginal: false }, mailbox, change)).toMatchObject({ status: "created" });

		h.threading.mockImplementationOnce(async (options: any) => {
			expect(await options.findAncestor(["<missing@example.com>"])).toBeNull();
			return { rfcMessageId: null, inReplyTo: null, referencesHeader: null, threadId: options.fallbackThreadId() };
		});
		mock.queueSelect([]).queueSelect([]);
		h.parse.mockResolvedValueOnce({
			fromAddr: null, toAddr: null, subject: null, text: null, html: null, attachments: [],
			messageId: null, inReplyTo: null, references: [],
		});
		expect(await persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			{ ...account, retainOriginal: false }, mailbox, change)).toMatchObject({ status: "created" });
		expect(mock.inserts.map((insert) => insert.values)).toEqual(expect.arrayContaining([
			expect.objectContaining({ fromAddr: "unknown@invalid.local", toAddr: '"Support" <support@example.com>' }),
		]));
	});

	it("uses sent-address fallbacks when MIME headers are absent and preserves an alternate recipient", async () => {
		h.parse.mockResolvedValue({
			fromAddr: null, toAddr: "customer@example.net", subject: null, text: null, html: null,
			attachments: [], messageId: null, inReplyTo: null, references: [],
		});
		mock.queueSelect([]).queueSelect([]);
		expect(await persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			{ ...account, retainOriginal: false }, { ...mailbox, displayName: null },
			{ ...change, remoteFolderKey: "sent" })).toMatchObject({ status: "created" });
		expect(mock.inserts.map((insert) => insert.values)).toEqual(expect.arrayContaining([
			expect.objectContaining({
				fromAddr: '"support" <support@example.com>', toAddr: "customer@example.net",
				direction: "outbound",
			}),
		]));
	});

	it("compensates a reconciled retained original when its mapping commit loses a race", async () => {
		mock.queueSelect([]).queueSelect([{ id: "msg_outbound" }]);
		mock.db.batch.mockRejectedValue(new Error("mapping race"));
		await expect(persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			account, mailbox, { ...change, remoteFolderKey: "sent" })).rejects.toThrow("mapping race");
		expect(bucket.delete).toHaveBeenCalledWith(expect.stringContaining("external-originals/"));

		mock = createDbMock();
		h.db = mock.db;
		mock.queueSelect([]).queueSelect([{ id: "msg_outbound" }]);
		mock.db.batch.mockRejectedValue(new Error("mapping race without original"));
		await expect(persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			{ ...account, retainOriginal: false }, mailbox, { ...change, remoteFolderKey: "sent" }))
			.rejects.toThrow("mapping race without original");
	});

	it("compensates R2 objects when the D1 batch fails", async () => {
		mock.queueSelect([]);
		mock.db.batch.mockRejectedValue(new Error("D1 unavailable"));
		await expect(persistExternalMessage({ BUCKET: bucket } as unknown as CloudflareEnv,
			account, mailbox, change)).rejects.toThrow("D1 unavailable");
		expect(bucket.delete).toHaveBeenCalledWith(expect.stringContaining("external-originals/"));
	});
});
