import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({
	tools: new Map<string, (input: Record<string, unknown>) => Promise<unknown>>(),
	configs: new Map<string, { inputSchema?: { safeParse: (input: unknown) => { success: boolean } } }>(),
	db: null as unknown,
	authorize: vi.fn(),
	listConversations: vi.fn(), getMessage: vi.fn(), getThread: vi.fn(), getAttachment: vi.fn(), listDrafts: vi.fn(),
	changeState: vi.fn(), sendMail: vi.fn(), forwardMail: vi.fn(),
	createDraft: vi.fn(), updateDraft: vi.fn(), deleteDraft: vi.fn(),
	handlerFetch: vi.fn(),
}));
vi.mock("@modelcontextprotocol/server", () => ({
	McpServer: class {
		registerTool(name: string, config: { inputSchema?: { safeParse: (input: unknown) => { success: boolean } } }, callback: (input: Record<string, unknown>) => Promise<unknown>) {
			h.configs.set(name, config); h.tools.set(name, callback);
		}
	},
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("agents/mcp/server", () => ({
	createMcpHandler: vi.fn((factory: () => unknown) => ({
		fetch: async () => { factory(); return h.handlerFetch(); },
	})),
}));
vi.mock("@/lib/mcp/auth", () => ({ authorizeMcpRequest: h.authorize }));
vi.mock("@/lib/mcp/read", () => ({
	listMcpConversations: h.listConversations, getMcpMessage: h.getMessage,
	getMcpThread: h.getThread, getMcpAttachment: h.getAttachment, listMcpDrafts: h.listDrafts,
}));
vi.mock("@/lib/mcp/actions", () => ({
	changeMcpMessageState: h.changeState, sendMcpMail: h.sendMail, forwardMcpMail: h.forwardMail,
}));
vi.mock("@/lib/mcp/drafts", () => ({
	createMcpDraft: h.createDraft, updateMcpDraft: h.updateDraft, deleteMcpDraft: h.deleteDraft,
}));
vi.mock("@/lib/ids", () => ({ newId: () => "req_1" }));

import { createLumimailMcpServer, mcpApiHandler } from "@/lib/mcp/server";

const env = { OAUTH_PROVIDER: {} } as never;
const identity = { userId: "usr_1", organizationId: "org_1", connectionId: "mcp_1" };

beforeEach(() => {
	vi.clearAllMocks(); h.tools.clear(); h.configs.clear(); h.db = createDbMock().db;
	h.listConversations.mockResolvedValue({ conversations: [] });
	h.getMessage.mockResolvedValue({ message: { id: "msg_1" }, attachments: [] });
	h.getThread.mockResolvedValue({ messages: [] });
	h.getAttachment.mockResolvedValue({ id: "att_1" });
	h.listDrafts.mockResolvedValue({ drafts: [] });
	h.changeState.mockResolvedValue({ updated: true });
	h.sendMail.mockResolvedValue({ messageId: "msg_sent", status: "queued" });
	h.forwardMail.mockResolvedValue({ messageId: "msg_fwd", status: "queued" });
	h.createDraft.mockResolvedValue({ id: "draft_1" });
	h.updateDraft.mockResolvedValue({ id: "draft_1" });
	h.deleteDraft.mockResolvedValue({ deleted: true });
	h.handlerFetch.mockResolvedValue(new Response("mcp", { status: 200 }));
});

describe("Lumimail MCP server", () => {
	it("registers and executes only the five read tools for read consent", async () => {
		const dbMock = createDbMock(); h.db = dbMock.db;
		dbMock.queueSelect([{ id: "mbx_1", localPart: "hello", displayName: "Hello", hostname: "example.com", role: "reader" }]);
		createLumimailMcpServer(env, { ...identity, scopes: ["mail.read"] });
		expect([...h.tools.keys()]).toEqual(["list_mailboxes", "list_conversations", "get_message", "get_thread", "get_attachment"]);
		const mailboxes = { mailboxes: [{ id: "mbx_1", address: "hello@example.com", displayName: "Hello", role: "reader" }] };
		await expect(h.tools.get("list_mailboxes")!({})).resolves.toEqual({
			content: [{ type: "text", text: JSON.stringify(mailboxes) }], structuredContent: mailboxes,
		});
		await h.tools.get("list_conversations")!({ query: "x", limit: 10, offset: 0 });
		await h.tools.get("get_message")!({ messageId: "msg_1" });
		await h.tools.get("get_thread")!({ threadId: "thr_1", limit: 20 });
		await h.tools.get("get_attachment")!({ attachmentId: "att_1", maxBytes: 10 });
		expect(h.listConversations).toHaveBeenCalledWith(env, "usr_1", "org_1", { query: "x", limit: 10, offset: 0 });
	});

	it("returns bounded not-found tool failures", async () => {
		createLumimailMcpServer(env, { ...identity, scopes: ["mail.read"] });
		h.getMessage.mockResolvedValue(null);
		h.getAttachment.mockResolvedValue(null);
		await expect(h.tools.get("get_message")!({ messageId: "foreign" })).rejects.toThrow("Message not found");
		await expect(h.tools.get("get_attachment")!({ attachmentId: "foreign", maxBytes: 10 })).rejects.toThrow("Attachment not found");
	});

	it("adds and executes mail-action tools only for explicit action scope", async () => {
		createLumimailMcpServer(env, { ...identity, scopes: ["mail.read", "mail.actions"] });
		expect(h.tools.size).toBe(13);
		await h.tools.get("list_drafts")!({ limit: 20 });
		await h.tools.get("create_draft")!({ subject: "Draft" });
		await h.tools.get("update_draft")!({ draftId: "draft_1", subject: "Updated" });
		await h.tools.get("delete_draft")!({ draftId: "draft_1" });
		await h.tools.get("change_message_state")!({ messageId: "msg_1", read: true });
		const sendInput = { from: "a@x", to: "b@x", subject: "Hi", text: "Body", idempotencyKey: "request_0123456789" };
		await h.tools.get("send_mail")!(sendInput);
		await h.tools.get("reply_mail")!({ ...sendInput, replyToMessageId: "msg_1" });
		await h.tools.get("forward_mail")!({ ...sendInput, sourceMessageId: "msg_1" });
		expect(h.changeState).toHaveBeenCalledWith(env, expect.objectContaining({ connectionId: "mcp_1", requestId: "req_1" }));
		expect(h.sendMail).toHaveBeenCalledTimes(2);
		for (const [name, valid, invalid] of [
			["change_message_state", { messageId: "msg_1", read: true }, { messageId: "msg_1" }],
			["send_mail", sendInput, { ...sendInput, text: undefined }],
			["reply_mail", { ...sendInput, replyToMessageId: "msg_1" }, { ...sendInput, text: undefined, replyToMessageId: "msg_1" }],
		] as const) {
			expect(h.configs.get(name)?.inputSchema?.safeParse(valid).success).toBe(true);
			expect(h.configs.get(name)?.inputSchema?.safeParse(invalid).success).toBe(false);
		}
	});

	it("bounds action misses", async () => {
		createLumimailMcpServer(env, { ...identity, scopes: ["mail.read", "mail.actions"] });
		h.createDraft.mockResolvedValue(null); h.updateDraft.mockResolvedValue(null); h.deleteDraft.mockResolvedValue(null); h.changeState.mockResolvedValue({ updated: false });
		await expect(h.tools.get("create_draft")!({})).rejects.toThrow("Draft target not found");
		await expect(h.tools.get("update_draft")!({ draftId: "x" })).rejects.toThrow("Draft not found");
		await expect(h.tools.get("delete_draft")!({ draftId: "x" })).rejects.toThrow("Draft not found");
		await expect(h.tools.get("change_message_state")!({ messageId: "x", read: true })).rejects.toThrow("Message not found");
	});

	it("denies before protocol handling and passes verified auth info on success", async () => {
		h.authorize.mockResolvedValue(null);
		expect((await mcpApiHandler.fetch!(new Request("https://mail.example/mcp") as never, env)).status).toBe(401);
		h.authorize.mockResolvedValue({
			token: "token", clientId: "client_1", scopes: ["mail.read"], expiresAt: 2_000_000_000,
			resource: new URL("https://mail.example/mcp"), props: identity,
		});
		expect((await mcpApiHandler.fetch!(new Request("https://mail.example/mcp") as never, env)).status).toBe(200);
		h.authorize.mockResolvedValue({
			token: "token", clientId: "client_1", scopes: ["mail.read"], expiresAt: 2_000_000_000,
			props: identity,
		});
		expect((await mcpApiHandler.fetch!(new Request("https://mail.example/mcp") as never, env)).status).toBe(200);
	});
});
