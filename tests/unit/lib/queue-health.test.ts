import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import {
	classifyQueueHealth,
	readQueueHealthSnapshots,
	runQueueHealthCheck,
} from "@/lib/queue-health";

let mock: DbMock;
const inboundMetrics = vi.fn();
const outboundMetrics = vi.fn();
const deadLetterMetrics = vi.fn();
const env = {
	INBOUND_QUEUE: { metrics: inboundMetrics },
	OUTBOUND_QUEUE: { metrics: outboundMetrics },
	OUTBOUND_DLQ_QUEUE: { metrics: deadLetterMetrics },
} as unknown as CloudflareEnv;
const now = new Date("2026-07-24T12:00:00.000Z");

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
	inboundMetrics.mockResolvedValue({ backlogCount: 0, backlogBytes: 0 });
	outboundMetrics.mockResolvedValue({ backlogCount: 0, backlogBytes: 0 });
	deadLetterMetrics.mockResolvedValue({ backlogCount: 0, backlogBytes: 0 });
});

describe("classifyQueueHealth", () => {
	it("classifies empty and young regular queues", () => {
		expect(classifyQueueHealth("inbound", 0, null, 0, now)).toBe("healthy");
		expect(
			classifyQueueHealth(
				"inbound",
				2,
				new Date("2026-07-24T11:59:00.000Z"),
				0,
				now,
			),
		).toBe("delayed");
	});

	it("requires attention for old work, dead letters, and stale jobs", () => {
		expect(
			classifyQueueHealth(
				"outbound",
				1,
				new Date("2026-07-24T11:58:00.000Z"),
				0,
				now,
			),
		).toBe("attention");
		expect(classifyQueueHealth("outbound_dlq", 1, now, 0, now)).toBe("attention");
		expect(classifyQueueHealth("outbound", 0, null, 1, now)).toBe("attention");
	});

	it("treats a future oldest timestamp as a young backlog", () => {
		expect(
			classifyQueueHealth(
				"inbound",
				1,
				new Date("2026-07-24T12:01:00.000Z"),
				0,
				now,
			),
		).toBe("delayed");
		expect(classifyQueueHealth("inbound", 1, null, 0, now)).toBe("attention");
	});
});

describe("runQueueHealthCheck", () => {
	it("checks and upserts all queues with normalized metrics", async () => {
		mock.queueSelect([{ count: 2 }]);
		inboundMetrics.mockResolvedValue({
			backlogCount: Number.NaN,
			backlogBytes: -5,
			oldestMessageTimestamp: new Date("invalid"),
		});
		outboundMetrics.mockResolvedValue({
			backlogCount: 3,
			backlogBytes: 900,
			oldestMessageTimestamp: new Date("2026-07-24T11:59:30.000Z").getTime(),
		});

		const result = await runQueueHealthCheck(env, now);

		expect(result).toEqual([
			expect.objectContaining({
				queue: "inbound",
				status: "healthy",
				backlogCount: 0,
				backlogBytes: 0,
				oldestMessageAt: null,
			}),
			expect.objectContaining({
				queue: "outbound",
				status: "attention",
				backlogCount: 3,
				staleJobCount: 2,
			}),
			expect.objectContaining({
				queue: "outbound_dlq",
				status: "healthy",
			}),
		]);
		expect(mock.inserts).toHaveLength(3);
		expect(inboundMetrics).toHaveBeenCalledOnce();
		expect(outboundMetrics).toHaveBeenCalledOnce();
		expect(deadLetterMetrics).toHaveBeenCalledOnce();
	});

	it("preserves other results when one metrics call fails and bounds the detail", async () => {
		mock.queueSelect([{ count: 0 }]);
		inboundMetrics.mockRejectedValue(new Error("secret provider response ".repeat(30)));
		deadLetterMetrics.mockResolvedValue({ backlogCount: 1, backlogBytes: 42 });

		const result = await runQueueHealthCheck(env, now);

		expect(result[0]).toMatchObject({
			queue: "inbound",
			status: "unavailable",
			detail: "Queue metrics could not be read",
		});
		expect(result[1]).toMatchObject({ queue: "outbound", status: "healthy" });
		expect(result[2]).toMatchObject({ queue: "outbound_dlq", status: "attention" });
		expect(result[0].detail?.length).toBeLessThanOrEqual(160);
	});

	it("marks outbound unavailable when stale-job inspection fails", async () => {
		mock.db.select.mockImplementationOnce(() => {
			throw new Error("D1 failure with internals");
		});

		const result = await runQueueHealthCheck(env, now);

		expect(result[0]).toMatchObject({ queue: "inbound", status: "healthy" });
		expect(result[1]).toMatchObject({
			queue: "outbound",
			status: "unavailable",
			detail: "Outbound job state could not be read",
		});
		expect(result[2]).toMatchObject({ queue: "outbound_dlq", status: "healthy" });
	});

	it("treats a missing stale-job count row as zero", async () => {
		mock.queueSelect([]);

		const result = await runQueueHealthCheck(env, now);

		expect(result[1]).toMatchObject({
			queue: "outbound",
			status: "healthy",
			staleJobCount: 0,
		});
	});
});

describe("readQueueHealthSnapshots", () => {
	it("returns stored rows in the fixed public queue order", async () => {
		mock.queueSelect([
			{
				queueKey: "outbound_dlq",
				status: "attention",
				backlogCount: 1,
				backlogBytes: 8,
				oldestMessageAt: now,
				staleJobCount: 0,
				detail: null,
				checkedAt: now,
			},
			{
				queueKey: "inbound",
				status: "healthy",
				backlogCount: 0,
				backlogBytes: 0,
				oldestMessageAt: null,
				staleJobCount: 0,
				detail: null,
				checkedAt: now,
			},
		]);

		expect((await readQueueHealthSnapshots(env)).map((row) => row.queue)).toEqual([
			"inbound",
			"outbound_dlq",
		]);
	});
});
