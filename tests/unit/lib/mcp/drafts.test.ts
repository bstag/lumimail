import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown, validate: vi.fn(), replyShape: vi.fn(() => null as Response | null) }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/drafts/validate", () => ({
	validateDraftInput: h.validate,
	validateDraftAccess: h.validate,
	validateReplySourceShape: h.replyShape,
	normalizedReplySourceId: (input: { replyToMessageId?: unknown }) => typeof input.replyToMessageId === "string" ? input.replyToMessageId.trim() : null,
}));
vi.mock("@/lib/email/parse", () => ({ buildSnippet: vi.fn(() => "snippet") }));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix ?? "id"}_fixed` }));

import { createMcpDraft, deleteMcpDraft, updateMcpDraft } from "@/lib/mcp/drafts";

describe("MCP draft actions", () => {
	let mock: ReturnType<typeof createDbMock>;
	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		h.validate.mockResolvedValue(null);
		h.replyShape.mockReturnValue(null);
	});

	const actor = { connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1" };

	it("creates a validated draft and content-free audit atomically", async () => {
		await expect(createMcpDraft({} as CloudflareEnv, actor, {
			mailboxId: "mbx_1", from: "a@example.com", to: "b@example.com", subject: "Hi", text: "Body",
		}, "req_1", new Date(1))).resolves.toEqual({ id: "msg_fixed" });
		expect(mock.db.batch).toHaveBeenCalledOnce();
		expect(mock.inserts[0].values).toMatchObject({ id: "msg_fixed", status: "draft", mailboxId: "mbx_1" });
		expect(mock.inserts[1].values).toMatchObject({ messageId: "msg_fixed", textBody: "Body" });
		expect(JSON.stringify(mock.inserts[2].values)).not.toMatch(/Body|a@example|subject/i);
	});

	it("fails closed when draft mailbox or reply-source validation denies", async () => {
		h.validate.mockResolvedValue(new Response(null, { status: 404 }));
		await expect(createMcpDraft({} as CloudflareEnv, actor, { mailboxId: "foreign" }, "req_1")).resolves.toBeNull();
		expect(mock.db.batch).not.toHaveBeenCalled();
	});

	it("creates a mailbox-free draft with default address and subject fields", async () => {
		await expect(createMcpDraft({} as CloudflareEnv, actor, { html: "<p>Draft</p>" }, "req_default"))
			.resolves.toEqual({ id: "msg_fixed" });
		expect(mock.inserts[0].values).toMatchObject({ mailboxId: null, organizationId: null, fromAddr: "", toAddr: "", subject: null });
	});

	it("updates only a send-accessible stored draft", async () => {
		mock.queueSelect([{ id: "msg_1", status: "draft" }]);
		await expect(updateMcpDraft({} as CloudflareEnv, actor, "msg_1", {
			mailboxId: "mbx_1", from: "a@example.com", subject: "Updated", html: "<p>Body</p>",
		}, "req_2", new Date(2))).resolves.toEqual({ id: "msg_1" });
		expect(mock.db.batch).toHaveBeenCalledOnce();
		mock = createDbMock(); h.db = mock.db; mock.queueSelect([{ id: "msg_1", status: "sent" }]);
		await expect(updateMcpDraft({} as CloudflareEnv, actor, "msg_1", {}, "req_3")).resolves.toBeNull();
	});

	it("rejects malformed reply shape, missing rows, and inaccessible update inputs", async () => {
		h.replyShape.mockReturnValueOnce(new Response(null, { status: 400 }));
		await expect(updateMcpDraft({} as CloudflareEnv, actor, "msg_1", {}, "req_shape")).resolves.toBeNull();
		mock.queueSelect([]);
		await expect(updateMcpDraft({} as CloudflareEnv, actor, "missing", {}, "req_missing")).resolves.toBeNull();
		mock = createDbMock(); h.db = mock.db; mock.queueSelect([{ id: "msg_1", status: "draft" }]);
		h.validate.mockResolvedValueOnce(new Response(null, { status: 404 }));
		await expect(updateMcpDraft({} as CloudflareEnv, actor, "msg_1", {}, "req_denied")).resolves.toBeNull();
	});

	it("updates a mailbox-free draft with defaulted fields", async () => {
		mock.queueSelect([{ id: "msg_1", status: "draft" }]);
		await expect(updateMcpDraft({} as CloudflareEnv, actor, "msg_1", { text: "Body" }, "req_defaults"))
			.resolves.toEqual({ id: "msg_1" });
		expect(mock.updates[0].set).toMatchObject({ mailboxId: null, organizationId: null, fromAddr: "", toAddr: "", subject: null });
	});

	it("deletes only a send-accessible draft with the audit in one batch", async () => {
		mock.queueSelect([{ id: "msg_1", status: "draft" }]);
		await expect(deleteMcpDraft({} as CloudflareEnv, actor, "msg_1", "req_4", new Date(4))).resolves.toEqual({ deleted: true });
		expect(mock.deletes).toHaveLength(1);
		expect(mock.db.batch).toHaveBeenCalledOnce();
	});

	it("does not delete missing or non-draft rows", async () => {
		mock.queueSelect([]);
		await expect(deleteMcpDraft({} as CloudflareEnv, actor, "missing", "req_5")).resolves.toBeNull();
		mock = createDbMock(); h.db = mock.db; mock.queueSelect([{ id: "msg_1", status: "sent" }]);
		await expect(deleteMcpDraft({} as CloudflareEnv, actor, "msg_1", "req_6")).resolves.toBeNull();
	});
});
