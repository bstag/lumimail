import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import { externalSyncCursors } from "@/db/schema";
import { cleanupAttachmentObjects } from "@/lib/email/attachment-storage";
import { newId } from "@/lib/ids";
import {
	prepareExternalMessage,
	type ExternalImportAccount,
	type ExternalImportMailbox,
	type ExternalImportResult,
} from "./import-message";
import { ExternalProviderRequestError, type ExternalRemoteChange } from "./provider-client";
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

export async function applyExternalSyncPage(
	env: CloudflareEnv,
	account: ExternalImportAccount,
	mailbox: ExternalImportMailbox,
	changes: ExternalRemoteChange[],
	cursors: ExternalCursorMutation[],
	now = new Date(),
): Promise<ExternalImportResult[]> {
	const db = getDb(env);
	const uniqueChanges = [...new Map(changes.map((change) => [change.remoteMessageId, change])).values()];
	const results: ExternalImportResult[] = [];
	for (const change of uniqueChanges) {
		const attemptedKeys: string[] = [];
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
