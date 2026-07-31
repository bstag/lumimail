import { eq, and, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, outboundJobs } from "@/db/schema";
import { failJobQueueUnavailable } from "@/lib/email/outbound/submit";

export type OutboundRecoveryResult =
	| { status: "queued" }
	| { status: "not_failed" }
	| { status: "queue_unavailable" };

/**
 * Returns a failed outbound job to the delivery queue after an operator has
 * resolved the cause. Callers must already have authorized send capability on
 * the owning mailbox; this function performs no authorization of its own.
 *
 * The `status = "failed"` predicate is the concurrency guard: `processOutboundQueue`
 * claims only `queued` jobs, so restoring that state hands the job back to the
 * ordinary at-most-once claim without a second delivery path, and two concurrent
 * recoveries can match at most once between them.
 */
export async function recoverOutboundJob(
	env: CloudflareEnv,
	messageId: string,
): Promise<OutboundRecoveryResult> {
	const db = getDb(env);
	const now = new Date();
	const [job] = await db
		.update(outboundJobs)
		.set({
			status: "queued",
			error: null,
			deliveryToken: null,
			recoveredAt: now,
			recoveryCount: sql`${outboundJobs.recoveryCount} + 1`,
			updatedAt: now,
		})
		.where(and(eq(outboundJobs.messageId, messageId), eq(outboundJobs.status, "failed")))
		.returning({ id: outboundJobs.id });

	if (!job) return { status: "not_failed" };

	await db.update(messages).set({ status: "queued" }).where(eq(messages.id, messageId));

	try {
		await env.OUTBOUND_QUEUE.send({ kind: "outbound", jobId: job.id });
		return { status: "queued" };
	} catch {
		await failJobQueueUnavailable(db, job.id, messageId);
		return { status: "queue_unavailable" };
	}
}
