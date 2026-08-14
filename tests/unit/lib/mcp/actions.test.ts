import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/outbound/submit", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/mcp/read", () => ({ getMcpMessage: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitUser: vi.fn() }));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix ?? "id"}_fixed` }));

import { sendEmail } from "@/lib/email/outbound/submit";
import { getMcpMessage } from "@/lib/mcp/read";
import { rateLimitUser } from "@/lib/rate-limit";
import { changeMcpMessageState, forwardMcpMail, sendMcpMail } from "@/lib/mcp/actions";

const send = vi.mocked(sendEmail);
const readMessage = vi.mocked(getMcpMessage);
const limiter = vi.mocked(rateLimitUser);

describe("MCP mail actions", () => {
	let mock: ReturnType<typeof createDbMock>;
	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		limiter.mockResolvedValue({ allowed: true, remaining: 49 });
		send.mockResolvedValue({ messageId: "msg_sent", status: "queued" });
	});

	it("changes only an accessible message and writes one content-free audit event", async () => {
		mock.queueSelect([{ id: "msg_1" }]);
		await expect(changeMcpMessageState({} as CloudflareEnv, {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", messageId: "msg_1",
			change: { read: true, starred: true, status: "archived" }, requestId: "req_1", now: new Date(1),
		})).resolves.toEqual({ updated: true });
		expect(mock.db.batch).toHaveBeenCalledOnce();
		const audit = mock.inserts.at(-1)?.values;
		expect(audit).toMatchObject({ action: "mcp.mutate", resourceType: "mcp_connection", resourceId: "mcp_1" });
		expect(JSON.stringify(audit)).not.toMatch(/msg_1|subject|body|recipient|query/i);
		mock = createDbMock(); h.db = mock.db; mock.queueSelect([]);
		await expect(changeMcpMessageState({} as CloudflareEnv, {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", messageId: "foreign",
			change: { read: true }, requestId: "req_2",
		})).resolves.toEqual({ updated: false });
		expect(mock.db.batch).not.toHaveBeenCalled();
	});

	it("hashes and passes a connection-scoped idempotency claim into durable send", async () => {
		const result = await sendMcpMail({} as CloudflareEnv, {
			connectionId: "mcp_1", userId: "usr_1", from: "a@example.com", to: "b@example.com",
			subject: "Hello", text: "Body", mailboxId: "mbx_1", idempotencyKey: "request_0123456789",
		});
		expect(result).toEqual({ messageId: "msg_sent", status: "queued" });
		expect(send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			userId: "usr_1",
			idempotency: expect.objectContaining({ principalType: "mcp", principalId: "mcp_1", key: "request_0123456789", requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
		}));
	});

	it("preserves optional HTML, reply, organization audit, and defaulted fields", async () => {
		await sendMcpMail({} as CloudflareEnv, {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1",
			from: "a@example.com", to: "b@example.com", subject: "Hello", html: "<p>Body</p>",
			replyToMessageId: "msg_source", idempotencyKey: "request_0123456789",
		});
		expect(send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			html: "<p>Body</p>", replyToMessageId: "msg_source",
			idempotency: expect.objectContaining({ audit: expect.objectContaining({ organizationId: "org_1" }) }),
		}));
		mock.queueSelect([{ id: "msg_1" }]);
		await expect(changeMcpMessageState({} as CloudflareEnv, {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", messageId: "msg_1",
			change: { read: false }, requestId: "req_default_time",
		})).resolves.toEqual({ updated: true });
	});

	it("fails closed when the durable send rate limit is exhausted", async () => {
		limiter.mockResolvedValue({ allowed: false, remaining: 0 });
		await expect(sendMcpMail({} as CloudflareEnv, {
			connectionId: "mcp_1", userId: "usr_1", from: "a@example.com", to: "b@example.com",
			subject: "Hello", idempotencyKey: "request_0123456789",
		})).rejects.toThrow("rate limit");
		expect(send).not.toHaveBeenCalled();
	});

	it("forwards only an accessible source and includes the stored body without reply headers", async () => {
		readMessage.mockResolvedValue({
			message: { id: "msg_source", from: "sender@example.com", subject: "Original", textBody: "Original body" },
			attachments: [],
		} as never);
		await forwardMcpMail({} as CloudflareEnv, {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", sourceMessageId: "msg_source",
			from: "a@example.com", to: "b@example.com", subject: "Fwd: Original", text: "See below",
			idempotencyKey: "request_0123456789",
		});
		const forwarded = send.mock.calls[0][1];
		expect(forwarded.text).toContain("---------- Forwarded message ----------");
		expect(forwarded).not.toHaveProperty("replyToMessageId");
		readMessage.mockResolvedValue(null);
		await expect(forwardMcpMail({} as CloudflareEnv, {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", sourceMessageId: "foreign",
			from: "a@example.com", to: "b@example.com", subject: "Fwd", idempotencyKey: "request_abcdefghij",
		})).rejects.toThrow("Source message not found");
	});

	it("uses snippet and empty fallbacks for forwarded content and preserves a mailbox", async () => {
		readMessage
			.mockResolvedValueOnce({ message: { from: "sender@example.com", subject: null, textBody: null, snippet: "Snippet" }, attachments: [] } as never)
			.mockResolvedValueOnce({ message: { from: "sender@example.com", subject: null, textBody: null, snippet: null }, attachments: [] } as never);
		for (const mailboxId of ["mbx_1", undefined]) {
			await forwardMcpMail({} as CloudflareEnv, {
				connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", sourceMessageId: "msg_source",
				from: "a@example.com", to: "b@example.com", subject: "Fwd", mailboxId,
				idempotencyKey: `request_${mailboxId ? "withmailbox" : "nomailbox_"}`,
			});
		}
		expect(send.mock.calls[0][1]).toMatchObject({ mailboxId: "mbx_1", text: expect.stringContaining("Snippet") });
		expect(send.mock.calls[1][1].text).toContain("Subject: \n");
	});
});
