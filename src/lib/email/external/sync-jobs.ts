import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { externalAccounts, externalSyncJobs } from "@/db/schema";
import { newId } from "@/lib/ids";

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

	return {
		jobId: active.id,
		created: false,
		enqueued: active.status === "pending"
			? await wakeExternalSyncJob(env, active.id, "External sync enqueue deferred")
			: false,
	};
}

export async function reconcileExternalSyncJobs(
	env: CloudflareEnv,
	now = new Date(),
): Promise<{ enqueued: number; created: number }> {
	const db = getDb(env);
	let enqueued = 0;
	let created = 0;
	const jobs = await db.select({ id: externalSyncJobs.id }).from(externalSyncJobs).where(and(
		eq(externalSyncJobs.status, "pending"),
		lte(externalSyncJobs.nextAttemptAt, now),
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
	return { enqueued, created };
}
