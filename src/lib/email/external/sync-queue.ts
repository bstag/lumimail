import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
	domains,
	externalAccounts,
	externalSyncJobs,
	mailboxes,
} from "@/db/schema";
import { refreshExternalAccountCredential } from "./credentials";
import {
	ExternalProviderRequestError,
} from "./provider-client";
import {
	getExternalProviderAdapter,
} from "./provider-adapter";
import { failExternalSyncJob } from "./sync-jobs";
import { MAX_CONSECUTIVE_FAILURES, POISON_STRIKES } from "./sync-policy";
import { applyExternalSyncPage, readExternalSyncCursor } from "./sync-page";

export type ExternalSyncQueueMessage = {
	kind: "external-sync";
	version: 1;
	jobId: string;
};

const queueMessageSchema = z.object({
	kind: z.literal("external-sync"),
	version: z.literal(1),
	jobId: z.string().min(1).max(100),
}).strict();

export function isExternalSyncQueueMessage(value: unknown): value is ExternalSyncQueueMessage {
	return queueMessageSchema.safeParse(value).success;
}
/** Jittered exponential backoff, capped at an hour, for the Nth consecutive failure (1-based). */
function retryDelay(failures: number): number {
	const ceiling = Math.min(3_600, 60 * 2 ** Math.max(0, failures - 1));
	return Math.max(1, Math.floor(ceiling * (0.5 + Math.random() * 0.5)));
}

/**
 * Content-free description of an unexpected sync failure. A database wrapper's own message quotes
 * the statement and its bound values (which can be message content), so only its cause is logged,
 * truncated; a non-Error throw is reduced to its type.
 */
function describeFailure(error: unknown): { errorName: string; detail: string } {
	const source = error instanceof Error && error.cause instanceof Error ? error.cause : error;
	if (!(source instanceof Error)) return { errorName: typeof source, detail: "" };
	return { errorName: source.name, detail: source.message.slice(0, 160) };
}

/** Returns a job to the queue after `delaySeconds`, keeping any stronger intent requested meanwhile. */
function requeueJob(
	db: ReturnType<typeof getDb>,
	jobId: string,
	now: Date,
	delaySeconds: number,
	extra: Partial<typeof externalSyncJobs.$inferInsert> = {},
) {
	return db.update(externalSyncJobs).set({
		status: "pending",
		kind: sql`coalesce(${externalSyncJobs.requestedKind}, ${externalSyncJobs.kind})`,
		requestedKind: null,
		attempts: sql`CASE WHEN ${externalSyncJobs.requestedKind} IS NULL THEN ${externalSyncJobs.attempts} ELSE 0 END`,
		leaseUntil: null,
		nextAttemptAt: new Date(now.getTime() + delaySeconds * 1000),
		...extra,
	}).where(eq(externalSyncJobs.id, jobId));
}

/** A successful page clears every failure the job has accumulated. */
const PAGE_SUCCEEDED = {
	strikeCount: 0,
	strikeMessageId: null,
	suspectMessageId: null,
	failureCount: 0,
} as const;

export async function processExternalSyncQueue(
	env: CloudflareEnv,
	payload: ExternalSyncQueueMessage,
	now = new Date(),
): Promise<{ action: "ack" } | { action: "retry"; delaySeconds: number }> {
	const db = getDb(env);
	const leaseUntil = new Date(now.getTime() + 2 * 60 * 1000);
	const [job] = await db.update(externalSyncJobs).set({
		status: "processing",
		attempts: sql`${externalSyncJobs.attempts} + 1`,
		leaseUntil,
		errorCode: null,
		// A message still marked in flight means the previous attempt died or failed on it: that is a
		// strike against that message, restarting at one if it is a different message than before.
		strikeCount: sql`CASE
			WHEN ${externalSyncJobs.suspectMessageId} IS NULL THEN ${externalSyncJobs.strikeCount}
			WHEN ${externalSyncJobs.suspectMessageId} = ${externalSyncJobs.strikeMessageId} THEN ${externalSyncJobs.strikeCount} + 1
			ELSE 1 END`,
		strikeMessageId: sql`coalesce(${externalSyncJobs.suspectMessageId}, ${externalSyncJobs.strikeMessageId})`,
		suspectMessageId: null,
	}).where(and(
		eq(externalSyncJobs.id, payload.jobId),
		or(
			and(
				eq(externalSyncJobs.status, "pending"),
				lte(externalSyncJobs.nextAttemptAt, now),
				or(isNull(externalSyncJobs.leaseUntil), lte(externalSyncJobs.leaseUntil, now)),
			),
			// A worker that died mid-page never released its job; an expired lease makes it claimable.
			and(eq(externalSyncJobs.status, "processing"), lte(externalSyncJobs.leaseUntil, now)),
		),
	)).returning();
	if (!job) return { action: "ack" };

	const [account] = await db.select({
		id: externalAccounts.id,
		organizationId: externalAccounts.organizationId,
		mailboxId: externalAccounts.mailboxId,
		ownerUserId: externalAccounts.ownerUserId,
		provider: externalAccounts.provider,
		externalAddress: externalAccounts.externalAddress,
		tokenCiphertext: externalAccounts.tokenCiphertext,
		tokenIv: externalAccounts.tokenIv,
		tokenKeyId: externalAccounts.tokenKeyId,
		status: externalAccounts.status,
		importMode: externalAccounts.importMode,
		retainOriginal: externalAccounts.retainOriginal,
		mailboxUserId: mailboxes.userId,
		mailboxOrganizationId: mailboxes.organizationId,
		mailboxLocalPart: mailboxes.localPart,
		mailboxDisplayName: mailboxes.displayName,
		mailboxHostname: domains.hostname,
	}).from(externalAccounts)
		.innerJoin(mailboxes, eq(mailboxes.id, externalAccounts.mailboxId))
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.where(eq(externalAccounts.id, job.accountId)).limit(1);
	if (!account || !["initial_sync", "active", "resync_required", "error"].includes(account.status)) {
		await db.update(externalSyncJobs).set({
			status: "failed", errorCode: "account_inactive", leaseUntil: null, completedAt: now,
		}).where(eq(externalSyncJobs.id, job.id));
		return { action: "ack" };
	}

	const fail = (
		accountStatus: "reconnect_required" | "resync_required" | "error",
		errorCode: string,
	) => failExternalSyncJob(env, { jobId: job.id, accountId: account.id, accountStatus, errorCode, now });
	/** A provider that is throttling or down is not the message's fault: back off, and clear the marker. */
	const retryTransient = async (errorCode: string) => {
		const failures = job.failureCount + 1;
		const delaySeconds = retryDelay(failures);
		await requeueJob(db, job.id, now, delaySeconds, { errorCode, failureCount: failures, suspectMessageId: null });
		return { action: "retry", delaySeconds } as const;
	};

	try {
		const credential = await refreshExternalAccountCredential(env, account, now);
		if (credential.status === "error") {
			if (credential.revoked) {
				await fail("reconnect_required", credential.code);
				return { action: "ack" };
			}
			if (credential.retryable) return await retryTransient(credential.code);
			await fail("error", credential.code);
			return { action: "ack" };
		}
		const importAccount = {
			id: account.id,
			organizationId: account.organizationId,
			mailboxId: account.mailboxId,
			ownerUserId: account.ownerUserId,
			provider: account.provider,
			retainOriginal: account.retainOriginal,
		};
		const mailbox = {
			id: account.mailboxId,
			userId: account.mailboxUserId,
			organizationId: account.mailboxOrganizationId,
			localPart: account.mailboxLocalPart,
			displayName: account.mailboxDisplayName,
			hostname: account.mailboxHostname,
		};
		const mode = job.kind === "initial" || job.kind === "resync" ? "initial" : "incremental";
		const adapter = getExternalProviderAdapter(account.provider);
		const page = await adapter.fetchSyncPage({
			accessToken: credential.accessToken,
			mode,
			importMode: account.importMode,
			readCursor: job.kind === "resync" && job.attempts === 1
				? async () => undefined
				: (key) => readExternalSyncCursor(env, account.id, key),
			fetcher: fetch,
			now,
		});
		await applyExternalSyncPage(env, importAccount, mailbox, page.changes, page.cursors, now, {
			jobId: job.id,
			skipMessageId: job.strikeCount >= POISON_STRIKES ? job.strikeMessageId : null,
		});
		if (page.hasMore) {
			await requeueJob(db, job.id, now, 0, PAGE_SUCCEEDED);
			return { action: "retry", delaySeconds: 1 };
		}
		await db.batch([
			db.update(externalSyncJobs).set({
				status: sql`CASE WHEN ${externalSyncJobs.requestedKind} IS NULL THEN 'completed' ELSE 'pending' END`,
				kind: sql`coalesce(${externalSyncJobs.requestedKind}, ${externalSyncJobs.kind})`,
				requestedKind: null,
				attempts: sql`CASE WHEN ${externalSyncJobs.requestedKind} IS NULL THEN ${externalSyncJobs.attempts} ELSE 0 END`,
				leaseUntil: null,
				nextAttemptAt: now,
				completedAt: sql`CASE WHEN ${externalSyncJobs.requestedKind} IS NULL THEN ${now} ELSE NULL END`,
				errorCode: null,
				...PAGE_SUCCEEDED,
			}).where(eq(externalSyncJobs.id, job.id)),
			db.update(externalAccounts).set({
				status: "active", lastSyncAt: now, lastErrorCode: null, updatedAt: now,
				errorRetryCount: 0, nextRetryAt: null,
			}).where(eq(externalAccounts.id, account.id)),
		]);
		return { action: "ack" };
	} catch (error) {
		if (error instanceof ExternalProviderRequestError) {
			if (error.code === "cursor_expired") {
				await fail("resync_required", error.code);
				return { action: "ack" };
			}
			if (error.code === "authorization_revoked") {
				await fail("reconnect_required", error.code);
				return { action: "ack" };
			}
			if (error.retryable) return await retryTransient(error.code);
		}
		const errorCode = error instanceof ExternalProviderRequestError ? error.code : "sync_failed";
		console.error("External sync failed", {
			accountId: account.id, jobId: job.id, errorCode, ...describeFailure(error),
		});
		const failures = job.failureCount + 1;
		if (failures >= MAX_CONSECUTIVE_FAILURES) {
			await fail("error", errorCode);
			return { action: "ack" };
		}
		// Leave the in-flight marker set: the next claim counts it as a strike against that message.
		const delaySeconds = retryDelay(failures);
		await requeueJob(db, job.id, now, delaySeconds, { errorCode, failureCount: failures });
		return { action: "retry", delaySeconds };
	}
}
