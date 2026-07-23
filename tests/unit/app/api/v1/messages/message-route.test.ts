import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	authenticateApiKey: vi.fn(),
	requireScope: vi.fn(),
	getMessageWithBody: vi.fn(),
	updateMessageForImap: vi.fn(),
}));

vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/api/auth", () => ({
	authenticateApiKey: m.authenticateApiKey,
	requireScope: m.requireScope,
}));
vi.mock("@/lib/email/inbound", () => ({ getMessageWithBody: m.getMessageWithBody }));
vi.mock("@/lib/email/imap-state", () => ({ updateMessageForImap: m.updateMessageForImap }));

import { GET, PATCH } from "@/app/api/v1/messages/[messageId]/route";

const context = { params: Promise.resolve({ messageId: "msg1" }) };
const messageUrl = "https://x.test/api/v1/messages/msg1?mailboxId=mb1";

beforeEach(() => {
	m.authenticateApiKey.mockReset();
	m.requireScope.mockReset();
	m.getMessageWithBody.mockReset();
	m.updateMessageForImap.mockReset();
	m.authenticateApiKey.mockResolvedValue({
		userId: "u1",
		organizationId: "o1",
		scopes: ["read"],
	});
	m.requireScope.mockReturnValue(true);
});

describe("GET /api/v1/messages/:id", () => {
	it("rejects invalid authentication and a missing read scope", async () => {
		m.authenticateApiKey.mockResolvedValueOnce(null);
		expect((await GET(new Request(messageUrl), context)).status).toBe(401);

		m.authenticateApiKey.mockResolvedValueOnce({ userId: "u1", organizationId: "o1", scopes: [] });
		m.requireScope.mockReturnValueOnce(false);
		expect((await GET(new Request(messageUrl), context)).status).toBe(401);
	});

	it("requires an explicit mailbox binding", async () => {
		const res = await GET(new Request("https://x.test/api/v1/messages/msg1"), context);
		expect(res.status).toBe(400);
		expect(m.getMessageWithBody).not.toHaveBeenCalled();
	});

	it("returns authorized metadata and body in the canonical envelope", async () => {
		m.getMessageWithBody.mockResolvedValue({
			message: { id: "msg1", mailboxId: "mb1", imapUid: 41 },
			body: { textBody: "hello", htmlBody: null },
		});

		const res = await GET(new Request(messageUrl), context);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: {
				message: { id: "msg1", mailboxId: "mb1", imapUid: 41 },
				body: { textBody: "hello", htmlBody: null },
			},
		});
		expect(m.getMessageWithBody).toHaveBeenCalledWith({}, "u1", "o1", "msg1", "mb1");
	});

	it("does not enumerate an unauthorized message", async () => {
		m.getMessageWithBody.mockResolvedValue(null);

		const res = await GET(new Request(messageUrl), context);

		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { message: "Message not found" } });
	});
});

describe("PATCH /api/v1/messages/:id", () => {
	it("rejects missing authentication", async () => {
		m.authenticateApiKey.mockResolvedValue(null);
		const res = await PATCH(
			new Request(messageUrl, {
				method: "PATCH",
				body: JSON.stringify({ read: true }),
			}),
			context,
		);
		expect(res.status).toBe(401);
	});

	it("requires an explicit mailbox binding", async () => {
		const res = await PATCH(
			new Request("https://x.test/api/v1/messages/msg1", {
				method: "PATCH",
				body: JSON.stringify({ read: true }),
			}),
			context,
		);
		expect(res.status).toBe(400);
		expect(m.updateMessageForImap).not.toHaveBeenCalled();
	});

	it("rejects invalid JSON", async () => {
		const res = await PATCH(
			new Request(messageUrl, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: "{",
			}),
			context,
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: { message: "Invalid JSON" } });
	});

	it("sets unread state and moves a message to trash", async () => {
		m.updateMessageForImap.mockResolvedValue({ id: "msg1", read: false, status: "trash" });

		const res = await PATCH(
			new Request(messageUrl, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ read: false, status: "trash" }),
			}),
			context,
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: { message: { id: "msg1", read: false, status: "trash" } },
		});
		expect(m.updateMessageForImap).toHaveBeenCalledWith({}, "u1", "o1", "msg1", "mb1", {
			read: false,
			status: "trash",
		});
	});

	it("accepts a status-only move to trash", async () => {
		m.updateMessageForImap.mockResolvedValue({ id: "msg1", status: "trash" });
		const res = await PATCH(
			new Request(messageUrl, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ status: "trash" }),
			}),
			context,
		);
		expect(res.status).toBe(200);
	});

	it("rejects an empty or unsupported state change", async () => {
		const res = await PATCH(
			new Request(messageUrl, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ starred: true }),
			}),
			context,
		);

		expect(res.status).toBe(400);
		expect(m.updateMessageForImap).not.toHaveBeenCalled();
	});

	it("does not enumerate an unauthorized message state change", async () => {
		m.updateMessageForImap.mockResolvedValue(null);
		const res = await PATCH(
			new Request(messageUrl, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ read: true }),
			}),
			context,
		);
		expect(res.status).toBe(404);
	});
});
