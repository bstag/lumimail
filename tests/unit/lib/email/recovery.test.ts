import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/providers", () => ({ selectOutboundProvider: vi.fn() }));
vi.mock("@/lib/email/webhooks", () => ({ dispatchWebhooks: vi.fn() }));
vi.mock("@/lib/contacts/service", () => ({ upsertContactFromAddress: vi.fn() }));
vi.mock("@/lib/email/parse", () => ({ buildSnippet: vi.fn(() => "snippet") }));
vi.mock("@/lib/ids", () => ({ newId: vi.fn((p?: string) => (p ? `${p}_id` : "raw_id")) }));

import { recoverOutboundJob } from "@/lib/email/send";
import { messages, outboundJobs } from "@/db/schema";

const queueSend = vi.fn();
const env = { OUTBOUND_QUEUE: { send: queueSend } } as unknown as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
	queueSend.mockReset();
	queueSend.mockResolvedValue(undefined);
});

describe("recoverOutboundJob", () => {
	it("returns the job to the queue when it is failed", async () => {
		mock.queueSelect([{ id: "job_1" }]);

		const result = await recoverOutboundJob(env, "msg_1");

		expect(result).toEqual({ status: "queued" });
		expect(queueSend).toHaveBeenCalledTimes(1);
		expect(queueSend).toHaveBeenCalledWith({ kind: "outbound", jobId: "job_1" });
	});

	it("restores the queued state the consumer claim requires", async () => {
		mock.queueSelect([{ id: "job_1" }]);

		await recoverOutboundJob(env, "msg_1");

		const jobUpdate = mock.updates.find((update) => update.table === outboundJobs);
		expect(jobUpdate?.set).toMatchObject({ status: "queued", error: null, deliveryToken: null });

		const messageUpdate = mock.updates.find((update) => update.table === messages);
		expect(messageUpdate?.set).toMatchObject({ status: "queued" });
	});

	it("records that an operator recovered the job", async () => {
		mock.queueSelect([{ id: "job_1" }]);

		await recoverOutboundJob(env, "msg_1");

		const jobUpdate = mock.updates.find((update) => update.table === outboundJobs);
		const set = jobUpdate?.set as Record<string, unknown>;
		expect(set.recoveredAt).toBeInstanceOf(Date);
		expect(set.recoveryCount).toBeDefined();
		// attempts must keep accumulating so provider attempt history stays visible
		expect(set).not.toHaveProperty("attempts");
	});

	it("does not enqueue when no failed job matches the message", async () => {
		mock.queueSelect([]);

		const result = await recoverOutboundJob(env, "msg_1");

		expect(result).toEqual({ status: "not_failed" });
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("returns the job to failed when the queue rejects it", async () => {
		mock.queueSelect([{ id: "job_1" }]);
		queueSend.mockRejectedValue(new Error("queue down"));

		const result = await recoverOutboundJob(env, "msg_1");

		expect(result).toEqual({ status: "queue_unavailable" });
		const failedJobUpdate = mock.updates.filter((update) => update.table === outboundJobs).at(-1);
		expect(failedJobUpdate?.set).toMatchObject({ status: "failed", error: "Queue unavailable" });
		const failedMessageUpdate = mock.updates.filter((update) => update.table === messages).at(-1);
		expect(failedMessageUpdate?.set).toMatchObject({ status: "failed" });
	});
});
