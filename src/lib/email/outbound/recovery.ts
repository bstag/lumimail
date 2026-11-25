import { eq, and, exists, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, outboundJobs } from "@/db/schema";

export type OutboundRecoveryResult =
	| { status: "queued" }
	| { status: "not_failed" };

/**
 * Returns a failed outbound job to the delivery queue after an operator has
 * resolved the cause. Callers must already have authorized send capability on
 * the owning mailbox; this function performs no authorization of its own.
 *
 * Recoverable jobs move back to queued in the same batch as their message.
 * The new generation keeps older queue notifications from claiming the job.
 */
export async function recoverOutboundJob(
	env: CloudflareEnv,
	messageId: string,
): Promise<OutboundRecoveryResult> {
	const db = getDb(env);
	const now = new Date();
	const recoverable = and(eq(outboundJobs.messageId, messageId), inArray(outboundJobs.status, ["failed", "uncertain"]));
	const [, jobs] = await db.batch([
		db.update(messages).set({ status: "queued" }).where(and(
			eq(messages.id, messageId), exists(db.select({ id: outboundJobs.id }).from(outboundJobs).where(recoverable)),
		)),
		db.update(outboundJobs).set({
			status: "queued",
			error: null,
			deliveryToken: null,
			recoveredAt: now,
			recoveryCount: sql`${outboundJobs.recoveryCount} + 1`,
			updatedAt: now,
		}).where(recoverable).returning({ id: outboundJobs.id, generation: outboundJobs.recoveryCount }),
	]);
	const [job] = jobs;

	if (!job) return { status: "not_failed" };

	try {
		await env.OUTBOUND_QUEUE.send({ kind: "outbound", jobId: job.id, generation: job.generation });
	} catch {
		console.warn("Outbound recovery notification deferred", { jobId: job.id });
	}
	return { status: "queued" };
}
