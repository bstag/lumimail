import { describe, expect, it, vi } from "vitest";

import { buildOperationsOverview, readOperationsOverview, readRuntimeReadiness } from "@/lib/operations";

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
const readiness = {
	status: "healthy" as const, provider: "cloudflare" as const,
	requiredCount: 9, readyCount: 9, missingCount: 0,
	storage: true, queues: true, delivery: true, service: true, assets: true,
};
const evidence = {
	status: "healthy" as const,
	records: ["recovery", "release", "smoke", "mail_flow"].map((category) => ({
		category: category as "recovery" | "release" | "smoke" | "mail_flow",
		outcome: "passed" as const, passedChecks: 1, totalChecks: 1,
		observedAt: checkedAt, recordedAt: checkedAt,
	})),
};

describe("operations overview", () => {
	it("aggregates only content-free queue and retention evidence", () => {
		const report = buildOperationsOverview({
			version: "0.1.0", schema: "0028", observedAt: "2026-08-12T18:02:00.000Z",
			readiness,
			evidence,
			queues,
			retention: { scanned: 9, orphans: 2, bytes: 150, oldestUploadedAt: checkedAt,
				sample: ["inbound/private-message.eml"] },
		});
		expect(report).toEqual({
			status: "attention", observedAt: "2026-08-12T18:02:00.000Z",
			application: { version: "0.1.0", schema: "0028" },
			readiness,
			evidence,
			queues: { status: "attention", checkedAt: "2026-08-12T18:01:00.000Z", queueCount: 2,
				attentionCount: 1, unavailableCount: 0, backlogCount: 3, backlogBytes: 150, staleJobCount: 1 },
			retention: { status: "attention", scanned: 9, orphanCount: 2, orphanBytes: 150,
				oldestOrphanAt: checkedAt },
		});
		expect(JSON.stringify(report)).not.toContain("private-message");
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.queues)).toBe(true);
		expect(Object.isFrozen(report.evidence.records)).toBe(true);
	});

	it("distinguishes healthy, unknown, and unavailable sections", () => {
		const healthy = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			readiness,
			evidence,
			queues: [queues[0]], retention: { scanned: 3, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] } });
		expect(healthy.status).toBe("healthy");
		expect(healthy.retention.status).toBe("healthy");

		const degraded = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			readiness,
			evidence,
			queues: null, retention: null });
		expect(degraded.status).toBe("unavailable");
		expect(degraded.queues.status).toBe("unavailable");
		expect(degraded.retention.status).toBe("unavailable");

		const unknown = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			readiness,
			evidence,
			queues: [], retention: { scanned: 0, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] } });
		expect(unknown.status).toBe("attention");
		expect(unknown.queues.status).toBe("unknown");

		const unavailableQueue = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			readiness,
			evidence,
			queues: [
				{ ...queues[0], status: "unavailable" },
				{ ...queues[1], status: "healthy", checkedAt: "2026-08-12T17:00:00.000Z" },
			], retention: { scanned: 0, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] } });
		expect(unavailableQueue.queues.status).toBe("unavailable");
		expect(unavailableQueue.queues.checkedAt).toBe(checkedAt);

		const delayed = buildOperationsOverview({ version: "0.1.0", schema: "0028", observedAt: checkedAt,
			readiness,
			evidence,
			queues: [{ ...queues[0], status: "delayed" }],
			retention: { scanned: 0, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] } });
		expect(delayed.queues.status).toBe("attention");
		expect(delayed.queues.attentionCount).toBe(1);
	});

	it("keeps one subsystem available when the other read throws and discards errors", async () => {
		const report = await readOperationsOverview({} as CloudflareEnv, "org_1", new Date("2026-08-12T18:02:00.000Z"), {
			readQueues: vi.fn().mockRejectedValue(new Error("private queue detail")),
			readRetention: vi.fn().mockResolvedValue({ scanned: 1, orphans: 0, bytes: 0, oldestUploadedAt: null,
				sample: ["private-key"] }),
			readReadiness: vi.fn().mockResolvedValue(readiness),
			readEvidence: vi.fn().mockResolvedValue(evidence),
			version: "0.1.0", schema: "0028",
		});
		expect(report.queues.status).toBe("unavailable");
		expect(report.retention.status).toBe("healthy");
		expect(JSON.stringify(report)).not.toMatch(/private queue detail|private-key/);

		const inverse = await readOperationsOverview({} as CloudflareEnv, "org_1", new Date("2026-08-12T18:02:00.000Z"), {
			readQueues: vi.fn().mockResolvedValue([queues[0]]),
			readRetention: vi.fn().mockRejectedValue(new Error("private object key")),
			readReadiness: vi.fn().mockResolvedValue(readiness),
			readEvidence: vi.fn().mockResolvedValue(evidence),
			version: "0.1.0", schema: "0028",
		});
		expect(inverse.queues.status).toBe("healthy");
		expect(inverse.retention.status).toBe("unavailable");
		expect(JSON.stringify(inverse)).not.toContain("private object key");

		const readinessFailure = await readOperationsOverview({} as CloudflareEnv, "org_1", new Date("2026-08-12T18:02:00.000Z"), {
			readQueues: vi.fn().mockResolvedValue([queues[0]]),
			readRetention: vi.fn().mockResolvedValue({ scanned: 1, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] }),
			readReadiness: vi.fn().mockRejectedValue(new Error("private binding identifier")),
			readEvidence: vi.fn().mockResolvedValue(evidence),
			version: "0.1.0", schema: "0028",
		});
		expect(readinessFailure.status).toBe("unavailable");
		expect(readinessFailure.readiness).toMatchObject({
			status: "unavailable", provider: "unsupported", readyCount: 0, missingCount: 9,
		});
		expect(JSON.stringify(readinessFailure)).not.toContain("private binding identifier");

		const evidenceFailure = await readOperationsOverview({} as CloudflareEnv, "org_1", new Date("2026-08-12T18:02:00.000Z"), {
			readQueues: vi.fn().mockResolvedValue([queues[0]]),
			readRetention: vi.fn().mockResolvedValue({ scanned: 1, orphans: 0, bytes: 0, oldestUploadedAt: null, sample: [] }),
			readReadiness: vi.fn().mockResolvedValue(readiness),
			readEvidence: vi.fn().mockRejectedValue(new Error("private artifact path")),
			version: "0.1.0", schema: "0032",
		});
		expect(evidenceFailure.evidence).toEqual({ status: "unavailable", records: [] });
		expect(evidenceFailure.status).toBe("unavailable");
		expect(JSON.stringify(evidenceFailure)).not.toContain("private artifact path");
	});

	it("reports runtime categories without retaining identifiers or secret values", () => {
		const env = {
			DB: {}, BUCKET: {}, INBOUND_QUEUE: {}, OUTBOUND_QUEUE: {}, OUTBOUND_DLQ_QUEUE: {},
			EMAIL: {}, WORKER_SELF_REFERENCE: {}, ASSETS: {}, IMAGES: {},
			MAIL_PROVIDER: "cloudflare", CF_ACCOUNT_ID: "private-account", RESEND_API_KEY: "private-secret",
		} as unknown as CloudflareEnv;
		const report = readRuntimeReadiness(env);
		expect(report).toEqual(readiness);
		expect(JSON.stringify(report)).not.toMatch(/private-account|private-secret|OUTBOUND|BUCKET/);
		expect(Object.isFrozen(report)).toBe(true);
	});

	it("fails closed for missing categories, unsupported providers, and empty Resend secrets", () => {
		const base = { DB: {}, BUCKET: {}, INBOUND_QUEUE: {}, OUTBOUND_QUEUE: {}, OUTBOUND_DLQ_QUEUE: {},
			WORKER_SELF_REFERENCE: {}, ASSETS: {}, IMAGES: {} };
		const unsupported = readRuntimeReadiness({ ...base, MAIL_PROVIDER: "private-provider" } as unknown as CloudflareEnv);
		expect(unsupported).toMatchObject({ status: "unavailable", provider: "unsupported", delivery: false,
			readyCount: 8, missingCount: 1 });
		expect(JSON.stringify(unsupported)).not.toContain("private-provider");

		const resend = readRuntimeReadiness({ ...base, MAIL_PROVIDER: " ReSeNd ", RESEND_API_KEY: " " } as unknown as CloudflareEnv);
		expect(resend).toMatchObject({ status: "unavailable", provider: "resend", delivery: false });
		const readyResend = readRuntimeReadiness({ ...base, MAIL_PROVIDER: "resend", RESEND_API_KEY: "private-secret" } as unknown as CloudflareEnv);
		expect(readyResend).toMatchObject({ status: "healthy", provider: "resend", delivery: true });
		expect(JSON.stringify(readyResend)).not.toContain("private-secret");

		const missingStorage = readRuntimeReadiness({ ...base, DB: undefined, EMAIL: {} } as unknown as CloudflareEnv);
		expect(missingStorage).toMatchObject({ status: "unavailable", storage: false, missingCount: 1 });
	});
});
