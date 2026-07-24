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
		body: body === undefined ? undefined : JSON.stringify(body),
	});
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
});
