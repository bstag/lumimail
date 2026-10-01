import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { externalAccounts, externalSyncJobs } from "@/db/schema";
import { newId } from "@/lib/ids";
import { AUTO_RETRY_DELAYS_SECONDS } from "./sync-policy";

export type ExternalSyncKind = "initial" | "incremental" | "resync" | "reconcile";

type ExternalSyncJobInsert = typeof externalSyncJobs.$inferInsert;

const KIND_RANK: Record<ExternalSyncKind, number> = {
	reconcile: 1,
	incremental: 2,
	initial: 3,
	resync: 4,
};

function strongerKind(
	left: ExternalSyncKind,
	right: ExternalSyncKind | null,
): ExternalSyncKind {
	if (!right) return left;
	return KIND_RANK[right] > KIND_RANK[left] ? right : left;
}

async function wakeExternalSyncJob(
	env: CloudflareEnv,
	jobId: string,
	warning: string,
): Promise<boolean> {
	try {
		await env.EXTERNAL_SYNC_QUEUE.send({ kind: "external-sync", version: 1, jobId });
		return true;
	} catch {
		console.warn(warning, { jobId });
		return false;
	}
}

function newJob(accountId: string, kind: ExternalSyncKind, now: Date): ExternalSyncJobInsert {
	return {
		id: newId("exj"),
		accountId,
		kind,
		status: "pending",
		attempts: 0,
		nextAttemptAt: now,
		createdAt: now,
	};
}

export async function commitInitialExternalSyncJob(
	env: CloudflareEnv,
	accountId: string,
	now: Date,
	commit: (job: ExternalSyncJobInsert) => Promise<void>,
): Promise<string> {
	const job = newJob(accountId, "initial", now);
	await commit(job);
	await wakeExternalSyncJob(env, job.id, "External initial sync enqueue deferred");
	return job.id;
}

export async function requestExternalSyncJob(
	env: CloudflareEnv,
	accountId: string,
	kind: ExternalSyncKind,
	now = new Date(),
): Promise<{ jobId: string; created: boolean; enqueued: boolean }> {
	const db = getDb(env);
	const candidate = newJob(accountId, kind, now);
	const [created] = await db.insert(externalSyncJobs).values(candidate)
		.onConflictDoNothing()
		.returning({ id: externalSyncJobs.id });
	if (created) {
		return {
			jobId: created.id,
			created: true,
			enqueued: await wakeExternalSyncJob(env, created.id, "External sync enqueue deferred"),
		};
	}

	const [active] = await db.select({
		id: externalSyncJobs.id,
		kind: externalSyncJobs.kind,
		requestedKind: externalSyncJobs.requestedKind,
		status: externalSyncJobs.status,
		leaseUntil: externalSyncJobs.leaseUntil,
	}).from(externalSyncJobs).where(and(
		eq(externalSyncJobs.accountId, accountId),
		inArray(externalSyncJobs.status, ["pending", "processing"]),
	)).limit(1);
	if (!active || (active.status !== "pending" && active.status !== "processing")) {
		throw new Error("Active external sync job conflict could not be resolved");
	}

	const effectiveKind = strongerKind(active.kind, active.requestedKind);
	if (KIND_RANK[kind] > KIND_RANK[effectiveKind]) {
		await db.update(externalSyncJobs).set(active.status === "pending"
			? { kind }
			: { requestedKind: kind })
			.where(and(
				eq(externalSyncJobs.id, active.id),
				eq(externalSyncJobs.status, active.status),
			));
	}

	const wakeable = active.status === "pending" ||
		(active.leaseUntil !== null && active.leaseUntil <= now);
	return {
		jobId: active.id,
		created: false,
		enqueued: wakeable
			? await wakeExternalSyncJob(env, active.id, "External sync enqueue deferred")
			: false,
	};
}

/**
 * Ends a job and moves its account to the state the failure calls for. A failure the system can
 * recover from (`error`, `resync_required`) also schedules the next automatic retry from the
 * backoff schedule; once the schedule is spent no retry is due and a person has to act. A failure
 * only the user can fix (`reconnect_required`) never schedules one.
 */
export async function failExternalSyncJob(
	env: CloudflareEnv,
	input: {
		jobId: string;
		accountId: string;
		accountStatus: "reconnect_required" | "resync_required" | "error";
		errorCode: string;
		now: Date;
	},
): Promise<void> {
	const db = getDb(env);
	const seconds = Math.floor(input.now.getTime() / 1000);
	const dueWhen = AUTO_RETRY_DELAYS_SECONDS.map((delay, index) => sql`WHEN ${index} THEN ${seconds + delay}`);
	const retry = input.accountStatus === "reconnect_required"
		? { nextRetryAt: null }
		: {
			errorRetryCount: sql`${externalAccounts.errorRetryCount} + 1`,
			nextRetryAt: sql`CASE ${externalAccounts.errorRetryCount} ${sql.join(dueWhen, sql` `)} ELSE NULL END`,
		};
	await db.batch([
		db.update(externalSyncJobs).set({
			status: "failed",
			errorCode: input.errorCode,
			leaseUntil: null,
			completedAt: input.now,
		}).where(eq(externalSyncJobs.id, input.jobId)),
		db.update(externalAccounts).set({
			status: input.accountStatus,
			lastErrorCode: input.errorCode,
			updatedAt: input.now,
			...retry,
		}).where(eq(externalAccounts.id, input.accountId)),
	]);
}

export async function reconcileExternalSyncJobs(
	env: CloudflareEnv,
	now = new Date(),
): Promise<{ enqueued: number; created: number }> {
	const db = getDb(env);
	let enqueued = 0;
	let created = 0;
	const jobs = await db.select({ id: externalSyncJobs.id }).from(externalSyncJobs).where(or(
		and(eq(externalSyncJobs.status, "pending"), lte(externalSyncJobs.nextAttemptAt, now)),
		and(eq(externalSyncJobs.status, "processing"), lte(externalSyncJobs.leaseUntil, now)),
	)).limit(100);
	for (const job of jobs) {
		if (await wakeExternalSyncJob(env, job.id, "External sync reconciliation enqueue deferred")) {
			enqueued += 1;
		}
	}

	const dueBefore = new Date(now.getTime() - 5 * 60 * 1000);
	const accounts = await db.select({ id: externalAccounts.id }).from(externalAccounts).where(and(
		eq(externalAccounts.status, "active"),
		or(isNull(externalAccounts.lastSyncAt), lte(externalAccounts.lastSyncAt, dueBefore)),
	)).limit(50);
	for (const account of accounts) {
		const result = await requestExternalSyncJob(env, account.id, "reconcile", now);
		if (result.created) created += 1;
		if (result.enqueued) enqueued += 1;
	}

	// Recoverable accounts whose backoff has elapsed get a resync. The due time is cleared as soon as
	// the retry job exists, so the in-flight job (not this scan) owns the account until it fails or
	// succeeds; a failure schedules the next, later retry.
	const recoverable = await db.select({ id: externalAccounts.id }).from(externalAccounts).where(and(
		inArray(externalAccounts.status, ["error", "resync_required"]),
		isNotNull(externalAccounts.nextRetryAt),
		lte(externalAccounts.nextRetryAt, now),
	)).limit(50);
	for (const account of recoverable) {
		const result = await requestExternalSyncJob(env, account.id, "resync", now);
		await db.update(externalAccounts).set({ nextRetryAt: null }).where(eq(externalAccounts.id, account.id));
		if (result.created) created += 1;
		if (result.enqueued) enqueued += 1;
	}
	return { enqueued, created };
}
