import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => ({
	guardUser: vi.fn(),
	sendEmail: vi.fn(),
	rateLimitUser: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/email/send", () => ({ sendEmail: m.sendEmail }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitUser: m.rateLimitUser }));

import { POST } from "@/app/api/send/route";

const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const validBody = { from: "a@x.test", to: "b@x.test", subject: "Hi", text: "Body" };

beforeEach(() => {
	m.guardUser.mockReset();
	m.sendEmail.mockReset();
	m.rateLimitUser.mockReset();
	m.rateLimitUser.mockReturnValue({ allowed: true });
});

function req(body?: unknown) {
	return new Request("https://x.test/api/send", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

function multipartReq(body: unknown, files: File[]) {
	const form = new FormData();
	form.set("payload", JSON.stringify(body));
	for (const file of files) form.append("attachment", file);
	return new Request("https://x.test/api/send", { method: "POST", body: form });
}

describe("POST /api/send", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await POST(req(validBody));
		expect(res.status).toBe(401);
	});

	it("returns 429 when the rate limit is exceeded", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.rateLimitUser.mockReturnValue({ allowed: false });
		const res = await POST(req(validBody));
		expect(res.status).toBe(429);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Send rate limit exceeded" } });
	});

	it("returns 400 for an invalid body", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(req({ from: "a@x.test" }));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Validation failed" } });
	});

	it("sends the email on success", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.sendEmail.mockResolvedValue({ messageId: "msg1", status: "queued" });
		const res = await POST(req(validBody));
		expect(res.status).toBe(202);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { messageId: "msg1", status: "queued" },
		});
		expect(m.sendEmail).toHaveBeenCalledWith({}, { userId: "u1", ...validBody });
	});

	it("accepts multipart attachments in the same send request", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.sendEmail.mockResolvedValue({ messageId: "msg1", status: "queued" });
		const file = new File(["hello"], "hello.txt", { type: "text/plain" });

		const res = await POST(multipartReq(validBody, [file]));

		expect(res.status).toBe(202);
		expect(m.sendEmail).toHaveBeenCalledWith({}, {
			userId: "u1",
			...validBody,
			attachments: [expect.objectContaining({
				filename: "hello.txt",
				contentType: "text/plain",
				size: 5,
			})],
		});
	});

	it("accepts matched CID inline images in the multipart send", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.sendEmail.mockResolvedValue({ messageId: "msg1", status: "queued" });
		const form = new FormData();
		form.set("payload", JSON.stringify({
			...validBody,
			html: '<p><img src="cid:chart_1" alt="Chart"></p>',
		}));
		form.append("inlineImage", new File(["png"], "chart.png", { type: "image/png" }));
		form.append("inlineImageId", "chart_1");

		const response = await POST(new Request("https://x.test/api/send", {
			method: "POST",
			body: form,
		}));

		expect(response.status).toBe(202);
		expect(m.sendEmail).toHaveBeenCalledWith({}, expect.objectContaining({
			attachments: [expect.objectContaining({
				filename: "chart.png",
				disposition: "inline",
				contentId: "chart_1",
			})],
		}));
	});

	it("rejects incomplete inline-image multipart metadata", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const form = new FormData();
		form.set("payload", JSON.stringify(validBody));
		form.append("inlineImage", new File(["png"], "chart.png", { type: "image/png" }));
		const response = await POST(new Request("https://x.test/api/send", {
			method: "POST",
			body: form,
		}));
		expect(response.status).toBe(400);
	});

	it("returns 415 for an unsupported request content type", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const res = await POST(new Request("https://x.test/api/send", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: "x",
		}));
		expect(res.status).toBe(415);
		const missingHeader = await POST(new Request("https://x.test/api/send", { method: "POST" }));
		expect(missingHeader.status).toBe(415);
	});

	it("rejects multipart without a payload", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const form = new FormData();
		form.set("attachment", "not a file");
		const missing = await POST(new Request("https://x.test/api/send", { method: "POST", body: form }));
		expect(missing.status).toBe(400);
	});

	it("rejects malformed or invalid multipart payloads", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const malformed = new FormData();
		malformed.set("payload", "{");
		const malformedRes = await POST(new Request("https://x.test/api/send", { method: "POST", body: malformed }));
		expect(malformedRes.status).toBe(400);

		const invalid = new FormData();
		invalid.set("payload", JSON.stringify({ from: "x" }));
		const invalidRes = await POST(new Request("https://x.test/api/send", { method: "POST", body: invalid }));
		expect(invalidRes.status).toBe(400);
	});

	it("rejects non-file attachment parts and unsafe files", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const nonFile = new FormData();
		nonFile.set("payload", JSON.stringify(validBody));
		nonFile.set("attachment", "text");
		const nonFileRes = await POST(new Request("https://x.test/api/send", { method: "POST", body: nonFile }));
		expect(nonFileRes.status).toBe(400);

		const unsafeRes = await POST(multipartReq(validBody, [
			new File(["x"], "script.js", { type: "text/plain" }),
		]));
		expect(unsafeRes.status).toBe(400);
	});

	it("rejects excessive attachment count and size before send", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const tooMany = Array.from(
			{ length: 11 },
			(_, index) => new File(["x"], `${index}.txt`, { type: "text/plain" }),
		);
		expect((await POST(multipartReq(validBody, tooMany))).status).toBe(400);
		expect((await POST(multipartReq(validBody, [
			new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" }),
		]))).status).toBe(400);
		expect(m.sendEmail).not.toHaveBeenCalled();
	});

	it("returns validation failure when JSON parsing throws", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const badRequest = {
			headers: new Headers({ "content-type": "application/json" }),
			json: async () => { throw new TypeError("bad stream"); },
		} as unknown as Request;
		const res = await POST(badRequest);
		expect(res.status).toBe(400);
	});

	it("returns 500 when sendEmail throws", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		m.sendEmail.mockRejectedValue(new Error("smtp down"));
		const res = await POST(req(validBody));
		expect(res.status).toBe(500);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Send failed" } });
	});

	it("returns 404 for an unassigned sender mailbox", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const error = new Error("denied");
		error.name = "SenderNotAllowedError";
		m.sendEmail.mockRejectedValue(error);
		const res = await POST(req(validBody));
		expect(res.status).toBe(404);
	});

	it("returns 404 for an inaccessible reply source", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1" } });
		const error = new Error("denied");
		error.name = "ReplySourceNotAllowedError";
		m.sendEmail.mockRejectedValue(error);
		const res = await POST(req({ ...validBody, replyToMessageId: "msg_parent" }));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({
			error: { message: "Reply source not found" },
		});
	});
});
