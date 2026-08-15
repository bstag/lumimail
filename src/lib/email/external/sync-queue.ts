import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
	domains,
	externalAccounts,
	externalSyncCursors,
	externalSyncJobs,
	mailboxes,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { persistExternalMessage } from "./import-message";
import { ExternalOAuthRefreshError, refreshExternalAccessToken } from "./oauth-provider";
import {
	ExternalProviderRequestError,
	fetchGoogleSyncPage,
	fetchMicrosoftSyncPage,
	type GoogleSyncCursor,
	type MicrosoftFolder,
	type MicrosoftSyncCursor,
} from "./provider-client";
import {
	decryptExternalSecret,
	encryptExternalSecret,
	parseExternalSecretKeyring,
} from "./secret-vault";

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

const googleCursorSchema = z.object({
	historyId: z.string().min(1).max(128).optional(),
	pageToken: z.string().min(1).max(4096).optional(),
}).strict();
const microsoftCursorSchema = z.object({
	url: z.string().min(1).max(16_384),
	complete: z.boolean(),
}).strict();
const MICROSOFT_FOLDERS: readonly MicrosoftFolder[] = ["inbox", "sent", "archive"];

function accountSecretAad(account: {
	id: string;
	organizationId: string;
	mailboxId: string;
	ownerUserId: string;
	provider: string;
}): string {
	return `external-account:${account.id}:${account.organizationId}:${account.mailboxId}:${account.ownerUserId}:${account.provider}`;
}

function cursorAad(accountId: string, folder: string): string {
	return `external-cursor:${accountId}:${folder}`;
}

async function readCursor<T>(
	env: CloudflareEnv,
	accountId: string,
	folder: string,
	schema: z.ZodType<T>,
): Promise<T | undefined> {
	const [row] = await getDb(env).select().from(externalSyncCursors).where(and(
		eq(externalSyncCursors.accountId, accountId),
		eq(externalSyncCursors.remoteFolderKey, folder),
	)).limit(1);
	if (!row) return undefined;
	const plaintext = await decryptExternalSecret({
		keyId: row.cursorKeyId,
		iv: row.cursorIv,
		ciphertext: row.cursorCiphertext,
	}, cursorAad(accountId, folder), parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS));
	let value: unknown;
	try {
		value = JSON.parse(plaintext);
	} catch {
		throw new ExternalProviderRequestError("cursor_expired", false);
	}
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new ExternalProviderRequestError("cursor_expired", false);
	return parsed.data;
}

async function writeCursor(
	env: CloudflareEnv,
	accountId: string,
	folder: string,
	type: "gmail_history" | "microsoft_delta",
	cursor: GoogleSyncCursor | MicrosoftSyncCursor,
	now: Date,
): Promise<void> {
	const sealed = await encryptExternalSecret(
		JSON.stringify(cursor),
		cursorAad(accountId, folder),
		parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS),
	);
	await getDb(env).insert(externalSyncCursors).values({
		id: newId("exc"),
		accountId,
		remoteFolderKey: folder,
		cursorType: type,
		cursorCiphertext: sealed.ciphertext,
		cursorIv: sealed.iv,
		cursorKeyId: sealed.keyId,
		updatedAt: now,
	}).onConflictDoUpdate({
		target: [externalSyncCursors.accountId, externalSyncCursors.remoteFolderKey],
		set: {
			cursorType: type,
			cursorCiphertext: sealed.ciphertext,
			cursorIv: sealed.iv,
			cursorKeyId: sealed.keyId,
			updatedAt: now,
		},
	});
}

function retryDelay(attempts: number): number {
	return Math.min(3_600, 60 * 2 ** Math.max(0, attempts - 1));
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
		const keyring = parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS);
		const refreshToken = await decryptExternalSecret({
			keyId: account.tokenKeyId,
			iv: account.tokenIv,
			ciphertext: account.tokenCiphertext,
		}, accountSecretAad(account), keyring);
		const tokens = await refreshExternalAccessToken(env, account.provider, refreshToken);
		if (tokens.refreshToken !== refreshToken) {
			const sealed = await encryptExternalSecret(tokens.refreshToken, accountSecretAad(account), keyring);
			await db.update(externalAccounts).set({
				tokenCiphertext: sealed.ciphertext,
				tokenIv: sealed.iv,
				tokenKeyId: sealed.keyId,
				updatedAt: now,
			}).where(and(
				eq(externalAccounts.id, account.id),
				eq(externalAccounts.tokenCiphertext, account.tokenCiphertext),
			));
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
		let hasMore = false;
		if (account.provider === "google") {
			const cursor = job.kind === "resync"
				? undefined
				: await readCursor(env, account.id, "gmail", googleCursorSchema);
			const page = await fetchGoogleSyncPage({
				accessToken: tokens.accessToken,
				mode,
				importMode: account.importMode,
				cursor,
			});
			for (const change of page.changes) {
				await persistExternalMessage(env, importAccount, mailbox, change, now);
			}
			await writeCursor(env, account.id, "gmail", "gmail_history", page.cursor, now);
			hasMore = page.hasMore;
		} else {
			for (const folder of MICROSOFT_FOLDERS) {
				const cursor = job.kind === "resync"
					? undefined
					: await readCursor(env, account.id, folder, microsoftCursorSchema);
				const page = await fetchMicrosoftSyncPage({
					accessToken: tokens.accessToken,
					folder,
					importMode: account.importMode,
					cursor,
				}, fetch, now);
				for (const change of page.changes) {
					await persistExternalMessage(env, importAccount, mailbox, change, now);
				}
				await writeCursor(env, account.id, folder, "microsoft_delta", page.cursor, now);
				hasMore ||= page.hasMore;
			}
		}
		if (hasMore) {
			await db.update(externalSyncJobs).set({
				status: "pending", leaseUntil: null, nextAttemptAt: now,
			}).where(eq(externalSyncJobs.id, job.id));
			return { action: "retry", delaySeconds: 1 };
		}
		await db.batch([
			db.update(externalSyncJobs).set({
				status: "completed", leaseUntil: null, completedAt: now, errorCode: null,
			}).where(eq(externalSyncJobs.id, job.id)),
			db.update(externalAccounts).set({
				status: "active", lastSyncAt: now, lastErrorCode: null, updatedAt: now,
			}).where(eq(externalAccounts.id, account.id)),
		]);
		return { action: "ack" };
	} catch (error) {
		if (error instanceof ExternalOAuthRefreshError && error.code === "authorization_revoked") {
			await markJobFailed(env, job.id, account.id, "reconnect_required", error.code, now);
			return { action: "ack" };
		}
		if (error instanceof ExternalProviderRequestError && error.code === "cursor_expired") {
			await markJobFailed(env, job.id, account.id, "resync_required", error.code, now);
			return { action: "ack" };
		}
		if ((error instanceof ExternalProviderRequestError || error instanceof ExternalOAuthRefreshError) && error.retryable) {
			const delaySeconds = retryDelay(job.attempts);
			await db.update(externalSyncJobs).set({
				status: "pending",
				leaseUntil: null,
				nextAttemptAt: new Date(now.getTime() + delaySeconds * 1000),
				errorCode: error.code,
			}).where(eq(externalSyncJobs.id, job.id));
			return { action: "retry", delaySeconds };
		}
		const errorCode = error instanceof ExternalProviderRequestError || error instanceof ExternalOAuthRefreshError
			? error.code : "sync_failed";
		await markJobFailed(env, job.id, account.id, "error", errorCode, now);
		return { action: "ack" };
	}
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
		try {
			await env.EXTERNAL_SYNC_QUEUE.send({ kind: "external-sync", version: 1, jobId: job.id });
			enqueued += 1;
		} catch {
			console.warn("External sync reconciliation enqueue deferred", { jobId: job.id });
		}
	}
	const dueBefore = new Date(now.getTime() - 5 * 60 * 1000);
	const accounts = await db.select({ id: externalAccounts.id }).from(externalAccounts).where(and(
		eq(externalAccounts.status, "active"),
		or(isNull(externalAccounts.lastSyncAt), lte(externalAccounts.lastSyncAt, dueBefore)),
	)).limit(50);
	for (const account of accounts) {
		const [existing] = await db.select({ id: externalSyncJobs.id }).from(externalSyncJobs).where(and(
			eq(externalSyncJobs.accountId, account.id),
			inArray(externalSyncJobs.status, ["pending", "processing"]),
		)).limit(1);
		if (existing) continue;
		const jobId = newId("exj");
		await db.insert(externalSyncJobs).values({
			id: jobId,
			accountId: account.id,
			kind: "reconcile",
			status: "pending",
			attempts: 0,
			nextAttemptAt: now,
			createdAt: now,
		});
		created += 1;
		try {
			await env.EXTERNAL_SYNC_QUEUE.send({ kind: "external-sync", version: 1, jobId });
			enqueued += 1;
		} catch {
			console.warn("External polling enqueue deferred", { jobId });
		}
	}
	return { enqueued, created };
}
