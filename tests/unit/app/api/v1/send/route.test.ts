import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	authenticateApiKey: vi.fn(),
	requireScope: vi.fn(),
	sendEmail: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/api/auth", () => ({
	authenticateApiKey: m.authenticateApiKey,
	requireScope: m.requireScope,
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: m.sendEmail }));

import { POST } from "@/app/api/v1/send/route";

const validBody = { from: "a@x.test", to: "b@x.test", subject: "Hi", text: "Body" };

beforeEach(() => {
	m.authenticateApiKey.mockReset();
	m.requireScope.mockReset();
	m.sendEmail.mockReset();
});

function req(body?: unknown, auth = "Bearer ep_key") {
	return new Request("https://x.test/api/v1/send", {
		method: "POST",
		headers: auth ? { authorization: auth } : {},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("POST /api/v1/send", () => {
	it("returns 401 when authentication fails", async () => {
		m.authenticateApiKey.mockResolvedValue(null);
		const res = await POST(req(validBody));
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Unauthorized" } });
	});

	it("returns 401 when the send scope is missing", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: [] });
		m.requireScope.mockReturnValue(false);
		const res = await POST(req(validBody));
		expect(res.status).toBe(401);
	});

	it("returns 400 for an invalid body", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		const res = await POST(req({ from: "a@x.test" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Validation failed" } });
	});

	it("sends the email on success", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		m.sendEmail.mockResolvedValue({ messageId: "msg1", status: "queued" });
		const res = await POST(req(validBody));
		expect(res.status).toBe(202);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { messageId: "msg1", status: "queued" },
		});
		expect(m.sendEmail).toHaveBeenCalledWith({}, { userId: "u1", ...validBody });
	});

	it("decodes API attachment content before sending", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		m.sendEmail.mockResolvedValue({ messageId: "msg1", status: "queued" });

		const res = await POST(req({
			...validBody,
			attachments: [{
				filename: "hello.txt",
				contentType: "text/plain",
				contentBase64: "aGVsbG8=",
			}],
		}));

		expect(res.status).toBe(202);
		expect(m.sendEmail).toHaveBeenCalledWith({}, expect.objectContaining({
			attachments: [expect.objectContaining({ filename: "hello.txt", size: 5 })],
		}));
	});

	it("returns 400 for malformed JSON", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		const res = await POST(new Request("https://x.test/api/v1/send", {
			method: "POST",
			headers: { authorization: "Bearer ep_key" },
			body: "{",
		}));
		expect(res.status).toBe(400);
	});

	it("rejects a non-array attachments value", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		const res = await POST(req({ ...validBody, attachments: "no" }));
		expect(res.status).toBe(400);
	});

	it.each([
		null,
		{},
		{ filename: 1, contentType: "text/plain", contentBase64: "" },
		{ filename: "x.txt", contentType: 1, contentBase64: "" },
		{ filename: "x.txt", contentType: "text/plain", contentBase64: 1 },
	])("rejects malformed attachment metadata %#", async (attachment) => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		const res = await POST(req({ ...validBody, attachments: [attachment] }));
		expect(res.status).toBe(400);
	});

	it("rejects excessive API attachment count and encoded size", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		const attachment = { filename: "x.txt", contentType: "text/plain", contentBase64: "" };
		expect((await POST(req({
			...validBody,
			attachments: Array.from({ length: 11 }, () => attachment),
		}))).status).toBe(400);
		expect((await POST(req({
			...validBody,
			attachments: [{ ...attachment, contentBase64: "A".repeat(4_194_308) }],
		}))).status).toBe(400);
		expect(m.sendEmail).not.toHaveBeenCalled();
	});

	it("returns 500 when sendEmail throws", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		m.sendEmail.mockRejectedValue(new Error("smtp down"));
		const res = await POST(req(validBody));
		expect(res.status).toBe(500);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Send failed" } });
	});

	it("returns 404 when the key owner is not assigned to the sender mailbox", async () => {
		m.authenticateApiKey.mockResolvedValue({ userId: "u1", scopes: ["send"] });
		m.requireScope.mockReturnValue(true);
		const error = new Error("denied");
		error.name = "SenderNotAllowedError";
		m.sendEmail.mockRejectedValue(error);
		const res = await POST(req(validBody));
		expect(res.status).toBe(404);
	});
});
