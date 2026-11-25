import { and, eq, exists, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { attachments, externalAccounts, externalMessages, messageBodies, messages } from "@/db/schema";
import { buildSnippet, parseRawMime, unsubscribeColumns, type ParsedEmail } from "@/lib/email/parse";
import { prepareMessageBody } from "@/lib/email/message-body-storage";
import { buildInboundAttachmentRows } from "@/lib/email/inbound-attachments";
import { cleanupAttachmentObjects } from "@/lib/email/attachment-storage";
import { refreshExternalAccountCredential } from "./credentials";
import { ExternalProviderRequestError, fetchExternalRawMime } from "./provider-client";

type ExternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Messages re-downloaded per account per scheduled run; sequential, so memory stays one message. */
export const BODY_REPAIR_BATCH = 25;
/**
 * Wall-clock budget per run. Re-parsing large newsletters is CPU-heavy and shares the
 * scheduled run's CPU limit with every other step, so the repair stops starting new messages
 * once this has passed; the rest wait for the next run.
 */
export const BODY_REPAIR_BUDGET_MS = 8_000;
const BODY_REPAIR_MAX_ATTEMPTS = 3;
const BODY_REPAIR_LEASE_MS = 5 * 60_000;
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
	options: { batchSize?: number; now?: Date; fetcher?: ExternalFetch; budgetMs?: number; clock?: () => number } = {},
): Promise<BodyRepairResult> {
	const db = getDb(env);
	const batchSize = options.batchSize ?? BODY_REPAIR_BATCH;
	const clock = options.clock ?? Date.now;
	const startedAt = options.now ?? new Date();
	const deadline = clock() + (options.budgetMs ?? BODY_REPAIR_BUDGET_MS);
	const result: BodyRepairResult = { repaired: 0, abandoned: 0, deferred: false };
	const available = and(
		eq(messageBodies.htmlBody, ""),
		or(isNull(messageBodies.repairLeaseUntil), lte(messageBodies.repairLeaseUntil, startedAt)),
	);

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
			available,
		));

	for (const account of accounts) {
		const candidates = await db.select({
			bodyId: messageBodies.id,
			messageId: messageBodies.messageId,
			userId: messages.userId,
			textBody: messageBodies.textBody,
			remoteMessageId: externalMessages.remoteMessageId,
			snippet: messages.snippet,
			attempts: messageBodies.repairAttempts,
		}).from(messageBodies)
			.innerJoin(externalMessages, and(
				eq(externalMessages.lumimailMessageId, messageBodies.messageId),
				eq(externalMessages.accountId, account.id),
			))
			.innerJoin(messages, eq(messages.id, messageBodies.messageId))
			.where(available)
			.orderBy(messageBodies.repairAttempts, messageBodies.id)
			.limit(batchSize);

		const credential = await refreshExternalAccountCredential(env, account, options.now);
		if (credential.status === "error") {
			result.deferred = true;
			continue;
		}

		for (const candidate of candidates) {
			if (clock() >= deadline) {
				result.deferred = true;
				return result;
			}
			const pending = and(available, eq(messageBodies.id, candidate.bodyId),
				eq(messageBodies.repairAttempts, candidate.attempts));
			async function abandon() {
				const rows = await db.update(messageBodies).set({ htmlBody: null, repairLeaseUntil: null })
					.where(pending).returning({ id: messageBodies.id });
				result.abandoned += rows.length;
			}
			if (candidate.attempts >= BODY_REPAIR_MAX_ATTEMPTS) {
				await abandon();
				continue;
			}
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
				await abandon();
				continue;
			}
			// Count the attempt before parsing so a killed invocation can be retried after the lease.
			const attempts = candidate.attempts + 1;
			const leaseUntil = new Date((options.now ?? new Date()).getTime() + BODY_REPAIR_LEASE_MS);
			const [claim] = await db.update(messageBodies).set({ repairAttempts: attempts, repairLeaseUntil: leaseUntil })
				.where(pending).returning({ id: messageBodies.id });
			if (!claim) continue;
			const parsed = await parseRawMime(
				raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
			);
			const owned = and(eq(messageBodies.id, candidate.bodyId), eq(messageBodies.htmlBody, ""),
				eq(messageBodies.repairAttempts, attempts));
			result.repaired += await saveRepairedBody(env, db, candidate, parsed, owned);
		}
	}
	return result;
}

async function saveRepairedBody(
	env: CloudflareEnv,
	db: AppDatabase,
	candidate: { messageId: string; userId: string; textBody: string | null; snippet: string | null },
	parsed: ParsedEmail,
	owned: SQL | undefined,
): Promise<number> {
	const prepared = prepareMessageBody(candidate.textBody ?? parsed.text, parsed.html?.trim() ? parsed.html : null);
	const downloads = buildInboundAttachmentRows(candidate.userId, candidate.messageId, prepared.overflow);
	const attemptedKeys: string[] = [];
	const bodyUpdate = db.update(messageBodies).set({
		htmlBody: prepared.htmlBody,
		textBody: prepared.textBody,
		repairLeaseUntil: null,
	}).where(owned).returning({ id: messageBodies.id });
	try {
		for (const { row, content } of downloads) {
			attemptedKeys.push(row.r2Key);
			await env.BUCKET.put(row.r2Key, content, { httpMetadata: { contentType: row.contentType } });
		}
		const inserts = downloads.map(({ row }) => db.insert(attachments).select(db.select({
			id: sql<string>`${row.id}`.as("id"), messageId: sql<string>`${row.messageId}`.as("message_id"),
			filename: sql<string>`${row.filename}`.as("filename"), contentType: sql<string>`${row.contentType}`.as("content_type"),
			size: sql<number>`${row.size}`.as("size"), r2Key: sql<string>`${row.r2Key}`.as("r2_key"),
			disposition: sql<"attachment">`'attachment'`.as("disposition"), contentId: sql<string | null>`null`.as("content_id"),
			createdAt: sql<Date>`unixepoch()`.as("created_at"),
		}).from(messageBodies).where(owned)));
		const messageUpdate = db.update(messages).set({
			...(candidate.snippet ? {} : { snippet: buildSnippet(candidate.textBody ?? parsed.text, parsed.html) }),
			...(downloads.length ? { attachmentStatus: sql`case when ${messages.attachmentStatus} = 'none' then 'stored' else ${messages.attachmentStatus} end` } : {}),
			...unsubscribeColumns(parsed),
		}).where(and(eq(messages.id, candidate.messageId),
			exists(db.select({ id: messageBodies.id }).from(messageBodies).where(owned))));
		const batch = await db.batch([messageUpdate, ...inserts, bodyUpdate]);
		const saved = batch.at(-1) as Array<{ id: string }>;
		if (saved.length === 0) await cleanupAttachmentObjects(env, attemptedKeys);
		return saved.length;
	} catch (error) {
		await cleanupAttachmentObjects(env, attemptedKeys);
		throw error;
	}
}
