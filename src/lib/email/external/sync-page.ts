import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import { externalMessageSkips, externalSyncCursors, externalSyncJobs } from "@/db/schema";
import { cleanupAttachmentObjects } from "@/lib/email/attachment-storage";
import { newId } from "@/lib/ids";
import {
	prepareExternalMessage,
	type ExternalImportAccount,
	type ExternalImportMailbox,
	type ExternalImportResult,
} from "./import-message";
import {
	ExternalProviderRequestError,
	MAX_EXTERNAL_MIME_BYTES,
	type ExternalRemoteChange,
} from "./provider-client";
import type { ExternalCursorMutation } from "./provider-adapter";
import {
	decryptExternalSecret,
	encryptExternalSecret,
	parseExternalSecretKeyring,
} from "./secret-vault";

function cursorContext(accountId: string, key: string): string {
	return `external-cursor:${accountId}:${key}`;
}

export async function readExternalSyncCursor(
	env: CloudflareEnv,
	accountId: string,
	key: string,
): Promise<unknown> {
	const [row] = await getDb(env).select().from(externalSyncCursors).where(and(
		eq(externalSyncCursors.accountId, accountId),
		eq(externalSyncCursors.remoteFolderKey, key),
	)).limit(1);
	if (!row) return undefined;
	const plaintext = await decryptExternalSecret({
		keyId: row.cursorKeyId,
		iv: row.cursorIv,
		ciphertext: row.cursorCiphertext,
	}, cursorContext(accountId, key), parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS));
	try {
		return JSON.parse(plaintext) as unknown;
	} catch {
		throw new ExternalProviderRequestError("cursor_expired", false);
	}
}

export type SkipReason = "too_large" | "repeated_failure";

/** Ledger entry plus a content-free log line; the message itself is never imported. */
async function skipMessage(
	env: CloudflareEnv,
	account: ExternalImportAccount,
	change: ExternalRemoteChange,
	reason: SkipReason,
	now: Date,
	results: ExternalImportResult[],
): Promise<void> {
	await getDb(env).insert(externalMessageSkips).values({
		id: newId("exs"),
		accountId: account.id,
		remoteMessageId: change.remoteMessageId,
		remoteFolderKey: change.remoteFolderKey,
		reason,
		createdAt: now,
	}).onConflictDoNothing();
	console.warn(
		reason === "too_large" ? "External message skipped: too large" : "External message skipped: repeated failure",
		{ accountId: account.id, folder: change.remoteFolderKey },
	);
	results.push({ status: "skipped", reason });
}

/**
 * `options.jobId` marks each message as in flight before it is materialized, so a worker that dies
 * mid-message leaves the culprit recorded on the job. `options.skipMessageId` names a message that
 * has already failed repeatedly; it is skipped rather than attempted again.
 */
export async function applyExternalSyncPage(
	env: CloudflareEnv,
	account: ExternalImportAccount,
	mailbox: ExternalImportMailbox,
	changes: ExternalRemoteChange[],
	cursors: ExternalCursorMutation[],
	now = new Date(),
	options?: { jobId: string; skipMessageId?: string | null },
): Promise<ExternalImportResult[]> {
	const db = getDb(env);
	const uniqueChanges = [...new Map(changes.map((change) => [change.remoteMessageId, change])).values()];
	const results: ExternalImportResult[] = [];
	// A message already in the skip ledger stays skipped, even after the strike counter has moved on.
	const ledgered = options && uniqueChanges.length > 0
		? new Map((await db.select({
			remoteMessageId: externalMessageSkips.remoteMessageId,
			reason: externalMessageSkips.reason,
		}).from(externalMessageSkips).where(and(
			eq(externalMessageSkips.accountId, account.id),
			inArray(externalMessageSkips.remoteMessageId, uniqueChanges.map((change) => change.remoteMessageId)),
		))).map((row) => [row.remoteMessageId, row.reason]))
		: new Map<string, SkipReason>();
	for (const change of uniqueChanges) {
		const attemptedKeys: string[] = [];
		const alreadySkipped = ledgered.get(change.remoteMessageId);
		if (alreadySkipped) {
			results.push({ status: "skipped", reason: alreadySkipped });
			continue;
		}
		if (options?.skipMessageId === change.remoteMessageId) {
			await skipMessage(env, account, change, "repeated_failure", now, results);
			continue;
		}
		if (change.sizeEstimate !== undefined && change.sizeEstimate > MAX_EXTERNAL_MIME_BYTES) {
			await skipMessage(env, account, change, "too_large", now, results);
			continue;
		}
		if (options) {
			await db.update(externalSyncJobs).set({ suspectMessageId: change.remoteMessageId })
				.where(eq(externalSyncJobs.id, options.jobId));
		}
		try {
			const loadRawMime = change.loadRawMime;
			let materializedChange = change;
			if (!change.rawMime && loadRawMime) {
				const metadata = { ...change };
				delete metadata.loadRawMime;
				materializedChange = { ...metadata, rawMime: await loadRawMime() };
			}
			const prepared = await prepareExternalMessage(
				env, account, mailbox, materializedChange, now, attemptedKeys,
			);
			if (prepared.statements.length > 0) {
				await db.batch(prepared.statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
			}
			results.push(prepared.result);
		} catch (error) {
			await cleanupAttachmentObjects(env, attemptedKeys);
			if (error instanceof ExternalProviderRequestError && error.code === "message_too_large") {
				await skipMessage(env, account, change, "too_large", now, results);
				continue;
			}
			throw error;
		}
	}
	const cursorStatements: BatchItem<"sqlite">[] = [];
	for (const cursor of cursors) {
		const sealed = await encryptExternalSecret(
			JSON.stringify(cursor.value),
			cursorContext(account.id, cursor.key),
			parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS),
		);
		cursorStatements.push(db.insert(externalSyncCursors).values({
			id: newId("exc"),
			accountId: account.id,
			remoteFolderKey: cursor.key,
			cursorType: cursor.type,
			cursorCiphertext: sealed.ciphertext,
			cursorIv: sealed.iv,
			cursorKeyId: sealed.keyId,
			updatedAt: now,
		}).onConflictDoUpdate({
			target: [externalSyncCursors.accountId, externalSyncCursors.remoteFolderKey],
			set: {
				cursorType: cursor.type,
				cursorCiphertext: sealed.ciphertext,
				cursorIv: sealed.iv,
				cursorKeyId: sealed.keyId,
				updatedAt: now,
			},
		}));
	}
	if (cursorStatements.length > 0) {
		await db.batch(cursorStatements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	}
	return results;
}
