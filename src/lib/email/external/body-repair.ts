import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { externalAccounts, externalMessages, messageBodies, messages } from "@/db/schema";
import { buildSnippet, parseRawMime, unsubscribeColumns } from "@/lib/email/parse";
import { refreshExternalAccountCredential } from "./credentials";
import { ExternalProviderRequestError, fetchExternalRawMime } from "./provider-client";

type ExternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Messages re-downloaded per account per scheduled run; sequential, so memory stays one message. */
export const BODY_REPAIR_BATCH = 25;
const REPAIRABLE_ACCOUNT_STATUSES = ["active", "initial_sync"] as const;

export type BodyRepairResult = { repaired: number; abandoned: number; deferred: boolean };

/**
 * Restores HTML for imported messages stored before the full-document sanitizer fix (F34,
 * 2026-11-07). That bug stored exactly `""`; a message with no HTML part stores NULL, so `""`
 * identifies affected rows precisely. Each repaired row ends non-empty or NULL, so the backlog
 * only shrinks. Native inbound mail cannot be repaired: its raw copy is deleted after parsing.
 */
export async function repairExternalMessageBodies(
	env: CloudflareEnv,
	options: { batchSize?: number; now?: Date; fetcher?: ExternalFetch } = {},
): Promise<BodyRepairResult> {
	const db = getDb(env);
	const batchSize = options.batchSize ?? BODY_REPAIR_BATCH;
	const result: BodyRepairResult = { repaired: 0, abandoned: 0, deferred: false };

	const accounts = await db.selectDistinct({
		id: externalAccounts.id,
		organizationId: externalAccounts.organizationId,
		mailboxId: externalAccounts.mailboxId,
		ownerUserId: externalAccounts.ownerUserId,
		provider: externalAccounts.provider,
		tokenCiphertext: externalAccounts.tokenCiphertext,
		tokenIv: externalAccounts.tokenIv,
		tokenKeyId: externalAccounts.tokenKeyId,
	}).from(externalAccounts)
		.innerJoin(externalMessages, eq(externalMessages.accountId, externalAccounts.id))
		.innerJoin(messageBodies, eq(messageBodies.messageId, externalMessages.lumimailMessageId))
		.where(and(
			inArray(externalAccounts.status, [...REPAIRABLE_ACCOUNT_STATUSES]),
			eq(messageBodies.htmlBody, ""),
		));

	for (const account of accounts) {
		const candidates = await db.select({
			bodyId: messageBodies.id,
			messageId: messageBodies.messageId,
			textBody: messageBodies.textBody,
			remoteMessageId: externalMessages.remoteMessageId,
			snippet: messages.snippet,
		}).from(messageBodies)
			.innerJoin(externalMessages, and(
				eq(externalMessages.lumimailMessageId, messageBodies.messageId),
				eq(externalMessages.accountId, account.id),
			))
			.innerJoin(messages, eq(messages.id, messageBodies.messageId))
			.where(eq(messageBodies.htmlBody, ""))
			.limit(batchSize);

		const credential = await refreshExternalAccountCredential(env, account, options.now);
		if (credential.status === "error") {
			result.deferred = true;
			continue;
		}

		for (const candidate of candidates) {
			let raw: Uint8Array;
			try {
				raw = await fetchExternalRawMime(
					account.provider, credential.accessToken, candidate.remoteMessageId, options.fetcher,
				);
			} catch (error) {
				const permanent = error instanceof ExternalProviderRequestError
					&& !error.retryable && error.code !== "authorization_revoked";
				if (!permanent) {
					// Throttled, offline, or revoked: stop this account until the next run.
					result.deferred = true;
					break;
				}
				// Deleted at the provider, too large, or malformed: stop retrying this row.
				await db.update(messageBodies).set({ htmlBody: null })
					.where(eq(messageBodies.id, candidate.bodyId));
				result.abandoned++;
				continue;
			}
			const parsed = await parseRawMime(
				raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
			);
			const bodyUpdate = db.update(messageBodies).set({
				htmlBody: parsed.html?.trim() ? parsed.html : null,
				textBody: candidate.textBody ?? parsed.text,
			}).where(eq(messageBodies.id, candidate.bodyId));
			await db.batch([bodyUpdate, db.update(messages).set({
				...(candidate.snippet ? {} : { snippet: buildSnippet(candidate.textBody ?? parsed.text, parsed.html) }),
				// Imports from before F98 never captured List-Unsubscribe.
				...unsubscribeColumns(parsed),
			}).where(eq(messages.id, candidate.messageId))]);
			result.repaired++;
		}
	}
	return result;
}
