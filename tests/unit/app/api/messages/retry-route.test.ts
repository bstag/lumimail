import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	recoverOutboundJob: vi.fn(),
	messageAccessCondition: vi.fn(() => "access-condition"),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/lib/email/send", () => ({ recoverOutboundJob: m.recoverOutboundJob }));
vi.mock("@/lib/auth/mailbox-access", () => ({
	messageAccessCondition: m.messageAccessCondition,
}));

import { POST } from "@/app/api/messages/[messageId]/retry/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.recoverOutboundJob.mockReset();
	m.messageAccessCondition.mockClear();
	m.guardUser.mockResolvedValue({ user: { id: "u1", organizationId: "org_1" } });
	m.recoverOutboundJob.mockResolvedValue({ status: "queued" });
});

function retry(messageId = "msg_1") {
	return POST(new Request(`https://x.test/api/messages/${messageId}/retry`, { method: "POST" }), {
		params: Promise.resolve({ messageId }),
	});
}

describe("POST /api/messages/[messageId]/retry", () => {
	it("returns the guard response when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({
			errorResponse: new Response(null, { status: 401 }),
		});

		expect((await retry()).status).toBe(401);
		expect(m.recoverOutboundJob).not.toHaveBeenCalled();
	});

	it("accepts recovery for a visible failed outbound message", async () => {
		mock.queueSelect([{ id: "msg_1" }]);

		const res = await retry();

		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({
			success: true,
			data: { messageId: "msg_1", status: "queued" },
		});
		expect(m.recoverOutboundJob).toHaveBeenCalledWith(expect.anything(), "msg_1");
	});

	it("requires send capability rather than read", async () => {
		mock.queueSelect([{ id: "msg_1" }]);

		await retry();

		expect(m.messageAccessCondition).toHaveBeenCalledWith(
			expect.anything(),
			"u1",
			"org_1",
			"send",
		);
	});

	it("returns 404 without recovering when the message is not visible", async () => {
		mock.queueSelect([]);

		const res = await retry();

		expect(res.status).toBe(404);
		expect(m.recoverOutboundJob).not.toHaveBeenCalled();
	});

	it("returns 409 when the message is not in a failed state", async () => {
		mock.queueSelect([{ id: "msg_1" }]);
		m.recoverOutboundJob.mockResolvedValue({ status: "not_failed" });

		const res = await retry();

		expect(res.status).toBe(409);
	});

	it("returns 503 when the queue rejects the recovered job", async () => {
		mock.queueSelect([{ id: "msg_1" }]);
		m.recoverOutboundJob.mockResolvedValue({ status: "queue_unavailable" });

		const res = await retry();

		expect(res.status).toBe(503);
	});

	it("enqueues only once when the same message is retried twice", async () => {
		mock.queueSelect([{ id: "msg_1" }]);
		mock.queueSelect([{ id: "msg_1" }]);
		m.recoverOutboundJob
			.mockResolvedValueOnce({ status: "queued" })
			.mockResolvedValueOnce({ status: "not_failed" });

		expect((await retry()).status).toBe(202);
		expect((await retry()).status).toBe(409);
	});
});
