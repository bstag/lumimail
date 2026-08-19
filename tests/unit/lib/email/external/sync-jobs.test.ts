import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown, newId: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/ids", () => ({ newId: h.newId }));

import {
	commitInitialExternalSyncJob,
	reconcileExternalSyncJobs,
	requestExternalSyncJob,
} from "@/lib/email/external/sync-jobs";

describe("external sync jobs", () => {
	let mock: DbMock;
	let send: ReturnType<typeof vi.fn>;
	let env: CloudflareEnv;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		h.newId.mockReturnValue("exj_new");
		send = vi.fn().mockResolvedValue(undefined);
		env = { EXTERNAL_SYNC_QUEUE: { send } } as unknown as CloudflareEnv;
	});

	it("commits an initial job with its account write before best-effort wake-up", async () => {
		const commit = vi.fn().mockResolvedValue(undefined);
		await expect(commitInitialExternalSyncJob(
			env, "exa_1", new Date("2026-08-19T12:00:00Z"), commit,
		)).resolves.toBe("exj_new");
		expect(commit).toHaveBeenCalledWith(expect.objectContaining({
			id: "exj_new", accountId: "exa_1", kind: "initial", status: "pending",
		}));
		expect(send).toHaveBeenCalledWith({ kind: "external-sync", version: 1, jobId: "exj_new" });
	});

	it("keeps a committed initial job recoverable when wake-up fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		send.mockRejectedValue(new Error("queue unavailable"));
		await expect(commitInitialExternalSyncJob(env, "exa_1", new Date(), vi.fn()))
			.resolves.toBe("exj_new");
		expect(warn).toHaveBeenCalledWith("External initial sync enqueue deferred", { jobId: "exj_new" });
		warn.mockRestore();
	});

	it("creates and wakes one new active job", async () => {
		mock.queueSelect([{ id: "exj_new" }]);
		await expect(requestExternalSyncJob(env, "exa_1", "incremental"))
			.resolves.toEqual({ jobId: "exj_new", created: true, enqueued: true });
		expect(mock.inserts[0]?.values).toEqual(expect.objectContaining({
			accountId: "exa_1", kind: "incremental", status: "pending",
		}));
	});

	it("upgrades pending work and records stronger intent behind processing work", async () => {
		mock.queueSelect([]).queueSelect([{
			id: "exj_pending", kind: "incremental", requestedKind: null, status: "pending",
		}]);
		await expect(requestExternalSyncJob(env, "exa_1", "resync"))
			.resolves.toEqual({ jobId: "exj_pending", created: false, enqueued: true });
		expect(mock.updates.at(-1)?.set).toEqual({ kind: "resync" });

		mock.queueSelect([]).queueSelect([{
			id: "exj_processing", kind: "incremental", requestedKind: null, status: "processing",
		}]);
		await expect(requestExternalSyncJob(env, "exa_1", "initial"))
			.resolves.toEqual({ jobId: "exj_processing", created: false, enqueued: false });
		expect(mock.updates.at(-1)?.set).toEqual({ requestedKind: "initial" });
	});

	it("reuses stronger work without downgrading it", async () => {
		mock.queueSelect([]).queueSelect([{
			id: "exj_active", kind: "incremental", requestedKind: "resync", status: "processing",
		}]);
		await expect(requestExternalSyncJob(env, "exa_1", "initial"))
			.resolves.toEqual({ jobId: "exj_active", created: false, enqueued: false });
		expect(mock.updates).toHaveLength(0);

		mock.queueSelect([]).queueSelect([{
			id: "exj_inconsistent", kind: "resync", requestedKind: "incremental", status: "processing",
		}]);
		await expect(requestExternalSyncJob(env, "exa_1", "initial"))
			.resolves.toEqual({ jobId: "exj_inconsistent", created: false, enqueued: false });
		expect(mock.updates).toHaveLength(0);
	});

	it("fails closed if an ignored insert has no active conflict", async () => {
		mock.queueSelect([]).queueSelect([]);
		await expect(requestExternalSyncJob(env, "exa_1", "incremental"))
			.rejects.toThrow("Active external sync job conflict could not be resolved");
	});

	it("reconciles due jobs and coalesces due accounts through the same interface", async () => {
		mock.queueSelect([{ id: "exj_due" }]).queueSelect([{ id: "exa_due" }])
			.queueSelect([{ id: "exj_new" }]);
		await expect(reconcileExternalSyncJobs(env, new Date("2026-08-19T12:00:00Z")))
			.resolves.toEqual({ enqueued: 2, created: 1 });
		expect(send).toHaveBeenCalledWith({ kind: "external-sync", version: 1, jobId: "exj_due" });
	});

	it("keeps failed wake-ups durable and reuses processing account work", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		send.mockRejectedValue(new Error("queue unavailable"));
		mock.queueSelect([{ id: "exj_due" }]).queueSelect([{ id: "exa_due" }])
			.queueSelect([]).queueSelect([{
				id: "exj_processing", kind: "incremental", requestedKind: null, status: "processing",
			}]);

		await expect(reconcileExternalSyncJobs(env)).resolves.toEqual({ enqueued: 0, created: 0 });
		expect(warn).toHaveBeenCalledWith(
			"External sync reconciliation enqueue deferred", { jobId: "exj_due" },
		);
		warn.mockRestore();
	});
});
