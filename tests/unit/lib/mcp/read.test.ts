import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import {
	getMcpAttachment,
	getMcpMessage,
	getMcpThread,
	listMcpDrafts,
	listMcpConversations,
} from "@/lib/mcp/read";

describe("MCP read tools", () => {
	let mock: ReturnType<typeof createDbMock>;
	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
	});

	it("returns bounded, deduplicated conversation summaries without tenant fields", async () => {
		mock.queueSelect([
			{ id: "msg_2", mailboxId: "mbx_1", threadId: "thr_1", direction: "inbound", fromAddr: "a@x", toAddr: "b@x", subject: "New", snippet: "Latest", status: "received", read: false, starred: false, createdAt: new Date(2) },
			{ id: "msg_1", mailboxId: "mbx_1", threadId: "thr_1", direction: "inbound", fromAddr: "a@x", toAddr: "b@x", subject: "Old", snippet: "Older", status: "received", read: true, starred: false, createdAt: new Date(1) },
			{ id: "msg_single", mailboxId: "mbx_1", threadId: null, direction: "outbound", fromAddr: "b@x", toAddr: "c@x", subject: null, snippet: null, status: "sent", read: true, starred: true, createdAt: new Date(0) },
		]);
		const result = await listMcpConversations({} as CloudflareEnv, "usr_1", "org_1", { limit: 10, offset: 0, query: " hello " });
		expect(result.conversations).toHaveLength(2);
		expect(result.conversations[0]).toMatchObject({ conversationId: "thr_1", latestMessageId: "msg_2", subject: "New" });
		expect(result.conversations[1].conversationId).toBe("message:msg_single");
		expect(JSON.stringify(result)).not.toMatch(/organizationId|userId|providerMessageId|r2Key/);
	});

	it("accepts an empty search without adding a text predicate", async () => {
		mock.queueSelect([]);
		await expect(listMcpConversations({} as CloudflareEnv, "usr_1", "org_1", {
			limit: 0, offset: -1, query: "   ",
		})).resolves.toEqual({ conversations: [], hasMore: false, limit: 1, offset: 0 });
	});

	it("returns one accessible message with bodies and bounded attachment metadata", async () => {
		mock.queueSelect([{ id: "msg_1", mailboxId: "mbx_1", threadId: "thr_1", fromAddr: "a@x", toAddr: "b@x", subject: "Hello", snippet: "Body", direction: "inbound", status: "received", read: false, starred: false, createdAt: new Date(1), textBody: "plain", htmlBody: "<p>plain</p>" }])
			.queueSelect([{ id: "att_1", filename: "file.txt", contentType: "text/plain", size: 5, disposition: "attachment" }]);
		await expect(getMcpMessage({} as CloudflareEnv, "usr_1", "org_1", "msg_1")).resolves.toMatchObject({
			message: { id: "msg_1", textBody: "plain" },
			attachments: [{ id: "att_1", filename: "file.txt" }],
		});
	});

	it("returns only accessible rows in a bounded thread and hides misses", async () => {
		mock.queueSelect([{ id: "msg_1", mailboxId: "mbx_1", threadId: "thr_1", fromAddr: "a", toAddr: "b", subject: null, direction: "inbound", status: "received", read: true, starred: false, createdAt: new Date(1), textBody: "x", htmlBody: null }]);
		expect((await getMcpThread({} as CloudflareEnv, "usr_1", "org_1", "thr_1", 20)).messages).toHaveLength(1);
		mock.queueSelect([]);
		await expect(getMcpMessage({} as CloudflareEnv, "usr_1", "org_1", "foreign")).resolves.toBeNull();
	});

	it("lists only send-accessible drafts", async () => {
		mock.queueSelect([{ id: "msg_draft", mailboxId: "mbx_1", threadId: null, direction: "outbound", fromAddr: "a", toAddr: "b", subject: "Draft", snippet: "body", status: "draft", read: true, starred: false, createdAt: new Date(1) }]);
		await expect(listMcpDrafts({} as CloudflareEnv, "usr_1", "org_1", 20)).resolves.toMatchObject({
			drafts: [{ id: "msg_draft", status: "draft" }],
		});
	});

	it("retrieves only an accessible attachment within both stored and actual byte bounds", async () => {
		const arrayBuffer = vi.fn(async () => new TextEncoder().encode("hello").buffer);
		const env = { BUCKET: { get: vi.fn(async () => ({ size: 5, arrayBuffer })) } } as unknown as CloudflareEnv;
		mock.queueSelect([{ id: "att_1", filename: "file.txt", contentType: "text/plain", size: 5, r2Key: "private-key" }]);
		await expect(getMcpAttachment(env, "usr_1", "org_1", "att_1", 10)).resolves.toEqual({
			id: "att_1", filename: "file.txt", contentType: "text/plain", size: 5, encoding: "base64", data: "aGVsbG8=",
		});
		expect(arrayBuffer).toHaveBeenCalledOnce();
		mock.queueSelect([{ id: "att_big", filename: "big", contentType: "x", size: 11, r2Key: "key" }]);
		await expect(getMcpAttachment(env, "usr_1", "org_1", "att_big", 10)).rejects.toThrow("size limit");
	});

	it("fails closed for attachment, object, and decoded-size misses", async () => {
		const get = vi.fn();
		const env = { BUCKET: { get } } as unknown as CloudflareEnv;
		mock.queueSelect([]);
		await expect(getMcpAttachment(env, "usr_1", "org_1", "missing", 10)).resolves.toBeNull();
		mock.queueSelect([{ id: "att_1", filename: "x", contentType: "x", size: 5, r2Key: "key" }]);
		get.mockResolvedValueOnce(null);
		await expect(getMcpAttachment(env, "usr_1", "org_1", "att_1", 10)).resolves.toBeNull();
		mock.queueSelect([{ id: "att_2", filename: "x", contentType: "x", size: 5, r2Key: "key" }]);
		get.mockResolvedValueOnce({ size: 11, arrayBuffer: vi.fn() });
		await expect(getMcpAttachment(env, "usr_1", "org_1", "att_2", 10)).rejects.toThrow("size limit");
		mock.queueSelect([{ id: "att_3", filename: "x", contentType: "x", size: 5, r2Key: "key" }]);
		get.mockResolvedValueOnce({ size: 5, arrayBuffer: async () => new Uint8Array(11).buffer });
		await expect(getMcpAttachment(env, "usr_1", "org_1", "att_3", 10)).rejects.toThrow("size limit");
	});
});
