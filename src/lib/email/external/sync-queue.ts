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
function retryDelay(attempts: number): number {
	const ceiling = Math.min(3_600, 60 * 2 ** Math.max(0, attempts - 1));
	return Math.max(1, Math.floor(ceiling * (0.5 + Math.random() * 0.5)));
}

async function markJobFailed(
	env: CloudflareEnv,
	jobId: string,
	accountId: string,
	accountStatus: "reconnect_required" | "resync_required" | "error",
	errorCode: string,
	now: Date,
): Promise<void> {
	const db = getDb(env);
	await db.batch([
		db.update(externalSyncJobs).set({
			status: "failed",
			errorCode,
			leaseUntil: null,
			completedAt: now,
		}).where(eq(externalSyncJobs.id, jobId)),
		db.update(externalAccounts).set({
			status: accountStatus,
			lastErrorCode: errorCode,
			updatedAt: now,
		}).where(eq(externalAccounts.id, accountId)),
	]);
}

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
	}).where(and(
		eq(externalSyncJobs.id, payload.jobId),
		eq(externalSyncJobs.status, "pending"),
		lte(externalSyncJobs.nextAttemptAt, now),
		or(isNull(externalSyncJobs.leaseUntil), lte(externalSyncJobs.leaseUntil, now)),
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

	try {
		const credential = await refreshExternalAccountCredential(env, account, now);
		if (credential.status === "error") {
			if (credential.revoked) {
				await markJobFailed(env, job.id, account.id, "reconnect_required", credential.code, now);
				return { action: "ack" };
			}
			if (credential.retryable) {
				const delaySeconds = retryDelay(job.attempts);
				await db.update(externalSyncJobs).set({
					status: "pending",
					kind: sql`coalesce(${externalSyncJobs.requestedKind}, ${externalSyncJobs.kind})`,
					requestedKind: null,
					attempts: sql`CASE WHEN ${externalSyncJobs.requestedKind} IS NULL THEN ${externalSyncJobs.attempts} ELSE 0 END`,
					leaseUntil: null,
					nextAttemptAt: new Date(now.getTime() + delaySeconds * 1000),
					errorCode: credential.code,
				}).where(eq(externalSyncJobs.id, job.id));
				return { action: "retry", delaySeconds };
			}
			await markJobFailed(env, job.id, account.id, "error", credential.code, now);
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
		await applyExternalSyncPage(env, importAccount, mailbox, page.changes, page.cursors, now);
		const hasMore = page.hasMore;
		if (hasMore) {
			await db.update(externalSyncJobs).set({
				status: "pending",
				kind: sql`coalesce(${externalSyncJobs.requestedKind}, ${externalSyncJobs.kind})`,
				requestedKind: null,
				attempts: sql`CASE WHEN ${externalSyncJobs.requestedKind} IS NULL THEN ${externalSyncJobs.attempts} ELSE 0 END`,
				leaseUntil: null,
				nextAttemptAt: now,
			}).where(eq(externalSyncJobs.id, job.id));
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
			}).where(eq(externalSyncJobs.id, job.id)),
			db.update(externalAccounts).set({
				status: "active", lastSyncAt: now, lastErrorCode: null, updatedAt: now,
			}).where(eq(externalAccounts.id, account.id)),
		]);
		return { action: "ack" };
	} catch (error) {
		if (error instanceof ExternalProviderRequestError && error.code === "cursor_expired") {
			await markJobFailed(env, job.id, account.id, "resync_required", error.code, now);
			return { action: "ack" };
		}
		if (error instanceof ExternalProviderRequestError && error.retryable) {
			const delaySeconds = retryDelay(job.attempts);
			await db.update(externalSyncJobs).set({
				status: "pending",
				kind: sql`coalesce(${externalSyncJobs.requestedKind}, ${externalSyncJobs.kind})`,
				requestedKind: null,
				attempts: sql`CASE WHEN ${externalSyncJobs.requestedKind} IS NULL THEN ${externalSyncJobs.attempts} ELSE 0 END`,
				leaseUntil: null,
				nextAttemptAt: new Date(now.getTime() + delaySeconds * 1000),
				errorCode: error.code,
			}).where(eq(externalSyncJobs.id, job.id));
			return { action: "retry", delaySeconds };
		}
		const errorCode = error instanceof ExternalProviderRequestError ? error.code : "sync_failed";
		await markJobFailed(env, job.id, account.id, "error", errorCode, now);
		return { action: "ack" };
	}
}
