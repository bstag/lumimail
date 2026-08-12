import { describe, expect, it, vi } from "vitest";

import { buildOperationsOverview, readOperationsOverview } from "@/lib/operations";

const checkedAt = "2026-08-12T18:00:00.000Z";
const queues = [{
	queue: "inbound" as const, label: "Inbound mail", status: "healthy" as const,
	backlogCount: 2, backlogBytes: 120, oldestMessageAt: checkedAt,
	staleJobCount: 0, detail: null, checkedAt,
}, {
	queue: "outbound" as const, label: "Outbound mail", status: "attention" as const,
	backlogCount: 1, backlogBytes: 30, oldestMessageAt: checkedAt,
	staleJobCount: 1, detail: null, checkedAt: "2026-08-12T18:01:00.000Z",
}];

describe("operations overview", () => {
	it("aggregates only content-free queue and retention evidence", () => {
		const report = buildOperationsOverview({
			version: "0.1.0", schema: "0028", observedAt: "2026-08-12T18:02:00.000Z",
			queues,
			retention: { scanned: 9, orphans: 2, bytes: 150, oldestUploadedAt: checkedAt,
				sample: ["inbound/private-message.eml"] },
		});
		expect(report).toEqual({
			status: "attention", observedAt: "2026-08-12T18:02:00.000Z",
			application: { version: "0.1.0", schema: "0028" },
			queues: { status: "attention", checkedAt: "2026-08-12T18:01:00.000Z", queueCount: 2,
				attentionCount: 1, unavailableCount: 0, backlogCount: 3, backlogBytes: 150, staleJobCount: 1 },
			retention: { status: "attention", scanned: 9, orphanCount: 2, orphanBytes: 150,
				oldestOrphanAt: checkedAt },
		});
		expect(JSON.stringify(report)).not.toContain("private-message");
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.queues)).toBe(true);
	});

	it("distinguishes healthy, unknown, and unavailable sections", () => {
		const healthy = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			queues: [queues[0]], retention: { scanned: 3, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] } });
		expect(healthy.status).toBe("healthy");
		expect(healthy.retention.status).toBe("healthy");

		const degraded = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			queues: null, retention: null });
		expect(degraded.status).toBe("unavailable");
		expect(degraded.queues.status).toBe("unavailable");
		expect(degraded.retention.status).toBe("unavailable");

		const unknown = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			queues: [], retention: { scanned: 0, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] } });
		expect(unknown.status).toBe("attention");
		expect(unknown.queues.status).toBe("unknown");

		const unavailableQueue = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			queues: [
				{ ...queues[0], status: "unavailable" },
				{ ...queues[1], status: "healthy", checkedAt: "2026-08-12T17:00:00.000Z" },
			], retention: { scanned: 0, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] } });
		expect(unavailableQueue.queues.status).toBe("unavailable");
		expect(unavailableQueue.queues.checkedAt).toBe(checkedAt);

		const delayed = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			queues: [{ ...queues[0], status: "delayed" }],
			retention: { scanned: 0, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] } });
		expect(delayed.queues.status).toBe("attention");
		expect(delayed.queues.attentionCount).toBe(1);
	});

	it("keeps one subsystem available when the other read throws and discards errors", async () => {
		const report = await readOperationsOverview({} as CloudflareEnv, new Date("2026-08-12T18:02:00.000Z"), {
			readQueues: vi.fn().mockRejectedValue(new Error("private queue detail")),
			readRetention: vi.fn().mockResolvedValue({ scanned: 1, orphans: 0, bytes: 0, oldestUploadedAt: null,
				sample: ["private-key"] }),
			version: "0.1.0", schema: "0028",
		});
		expect(report.queues.status).toBe("unavailable");
		expect(report.retention.status).toBe("healthy");
		expect(JSON.stringify(report)).not.toMatch(/private queue detail|private-key/);

		const inverse = await readOperationsOverview({} as CloudflareEnv, new Date("2026-08-12T18:02:00.000Z"), {
			readQueues: vi.fn().mockResolvedValue([queues[0]]),
			readRetention: vi.fn().mockRejectedValue(new Error("private object key")),
			version: "0.1.0", schema: "0028",
		});
		expect(inverse.queues.status).toBe("healthy");
		expect(inverse.retention.status).toBe("unavailable");
		expect(JSON.stringify(inverse)).not.toContain("private object key");
	});
});
