import { describe, expect, it, vi } from "vitest";
import { createMigratedDb, seedMessage } from "../../helpers/sqlite";
import { outboundJobs } from "@/db/schema";
import type { AppDatabase } from "@/db";

const state = vi.hoisted(() => ({ db: null as AppDatabase | null }));
vi.mock("@/db", () => ({ getDb: () => state.db }));

import { reconcileOutboundJobs } from "@/lib/email/outbound/consumer";
import { recoverOutboundJob } from "@/lib/email/outbound/recovery";

describe("outbound reconciliation", () => {
	it("wakes queued work and atomically records and recovers an expired delivery", async () => {
		const { db, sqlite } = createMigratedDb();
		state.db = db;
		const sendBatch = vi.fn();
		const send = vi.fn();
		const env = { OUTBOUND_QUEUE: { send, sendBatch } } as unknown as CloudflareEnv;
		const now = new Date("2026-11-24T12:30:00Z");
		const old = new Date("2026-11-24T12:00:00Z");
		try {
			for (const id of ["queued", "expired", "running"]) {
				seedMessage(sqlite, { id, direction: "outbound", status: "queued" });
				await db.insert(outboundJobs).values({
					id: `job_${id}`, userId: "u1", messageId: id, payload: "{}",
					status: id === "queued" ? "queued" : "processing",
					updatedAt: id === "running" ? now : old,
				});
			}
			await reconcileOutboundJobs(env, now);
			expect(sendBatch).toHaveBeenCalledWith([{ body: { kind: "outbound", jobId: "job_queued", generation: 0 } }]);
			expect(sqlite.prepare("SELECT id, status FROM outbound_jobs ORDER BY id").all()).toEqual([
				{ id: "job_expired", status: "uncertain" }, { id: "job_queued", status: "queued" }, { id: "job_running", status: "processing" },
			]);
			expect(sqlite.prepare("SELECT status FROM messages WHERE id = 'expired'").get()).toEqual({ status: "uncertain" });
			await expect(recoverOutboundJob(env, "expired")).resolves.toEqual({ status: "queued" });
			expect(send).toHaveBeenCalledWith({ kind: "outbound", jobId: "job_expired", generation: 1 });
			expect(sqlite.prepare("SELECT status FROM messages WHERE id = 'expired'").get()).toEqual({ status: "queued" });
			await reconcileOutboundJobs(env, old);
			expect(sendBatch).toHaveBeenCalledOnce();
		} finally {
			sqlite.close();
		}
	});
});
