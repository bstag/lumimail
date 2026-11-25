import { eq, and, exists, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { messages, outboundJobs } from "@/db/schema";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { selectOutboundProvider } from "@/lib/email/providers";
import { AUTO_REPLY_HEADERS } from "@/lib/email/auto-reply";
import { OutboundProviderError, type OutboundSendResult } from "@/lib/email/providers/types";
import { type ValidatedOutboundAttachment } from "@/lib/email/outbound-attachments";
import { attachmentKey } from "@/lib/email/attachment-storage";
import {
	MAX_STORED_ERROR_LENGTH,
	RETRY_DELAY_SECONDS,
} from "@/lib/constants";
import { normalizeRfcMessageId } from "@/lib/email/threading";
import { prepareHtmlForDelivery } from "@/lib/email/delivery-html";
import {
	parseDeliverySnapshot,
	type OutboundAttachmentSnapshot,
	type OutboundQueueMessage,
} from "@/lib/email/outbound/snapshot";
import { sendExternalProviderMessage } from "@/lib/email/external/outbound";

export type OutboundQueueResult =
	| { action: "ack" }
	| { action: "retry"; delaySeconds: number };

async function loadOutboundAttachments(
	env: CloudflareEnv,
	snapshots: OutboundAttachmentSnapshot[] | undefined,
	userId: string,
	messageId: string,
): Promise<ValidatedOutboundAttachment[] | null> {
	if (!snapshots?.length) return [];
	const loaded: ValidatedOutboundAttachment[] = [];
	for (const snapshot of snapshots) {
		// Security check: a stored snapshot may only name a key under the owning
		// user and message. The expected prefix is derived from the same helper
		// that wrote the key, so the two cannot drift apart.
		if (snapshot.r2Key !== attachmentKey(userId, messageId, snapshot.id)) return null;
		const object = await env.BUCKET.get(snapshot.r2Key);
		if (!object || object.size !== snapshot.size) return null;
		const content = await object.arrayBuffer();
		if (content.byteLength !== snapshot.size) return null;
		loaded.push({
			filename: snapshot.filename,
			contentType: snapshot.contentType,
			size: snapshot.size,
			content,
			disposition: snapshot.disposition ?? "attachment",
			...(snapshot.contentId ? { contentId: snapshot.contentId } : {}),
		});
	}
	return loaded;
}

function providerFailureMessage(error: unknown): string {
	if (!(error instanceof OutboundProviderError)) return "Outbound provider failed";
	const message = error.message.slice(0, MAX_STORED_ERROR_LENGTH);
	return error.code ? `${error.code}: ${message}` : message;
}

async function markOutboundFailed(
	env: CloudflareEnv,
	jobId: string,
	error: string,
	guard?: SQL,
): Promise<boolean> {
	const db = getDb(env);
	const claim = and(eq(outboundJobs.id, jobId), inArray(outboundJobs.status, ["queued", "processing"]), guard);
	const [, jobs] = await db.batch([
		db.update(messages).set({ status: "failed" }).where(exists(
			db.select({ id: outboundJobs.id }).from(outboundJobs)
				.where(and(claim, eq(outboundJobs.messageId, messages.id))),
		)),
		db.update(outboundJobs).set({
			status: "failed",
			error: error.slice(0, MAX_STORED_ERROR_LENGTH),
			deliveryToken: null,
			updatedAt: new Date(),
		}).where(claim).returning({
			id: outboundJobs.id,
			userId: outboundJobs.userId,
			messageId: outboundJobs.messageId,
		}),
	]);
	const [job] = jobs;
	if (!job) return false;

	if (job.messageId) {
		await dispatchWebhooks(env, job.userId, "message.failed", {
			messageId: job.messageId,
			error,
		});
	}
	return true;
}

const UNCERTAIN_DELIVERY = "Outbound delivery outcome is unknown; verify delivery before retrying";

async function markOutboundUncertain(db: AppDatabase, jobId: string, guard: SQL) {
	const claim = and(eq(outboundJobs.id, jobId), eq(outboundJobs.status, "processing"), guard);
	await db.batch([
		db.update(messages).set({ status: "uncertain" }).where(exists(
			db.select({ id: outboundJobs.id }).from(outboundJobs)
				.where(and(claim, eq(outboundJobs.messageId, messages.id))),
		)),
		db.update(outboundJobs).set({
			status: "uncertain", error: UNCERTAIN_DELIVERY, deliveryToken: null, updatedAt: new Date(),
		}).where(claim),
	]);
}

export async function reconcileOutboundJobs(env: CloudflareEnv, now = new Date()) {
	const db = getDb(env);
	const queuedBefore = new Date(now.getTime() - 2 * 60_000);
	const expiredBefore = new Date(now.getTime() - 20 * 60_000);
	const due = await db.select({ id: outboundJobs.id, generation: outboundJobs.recoveryCount }).from(outboundJobs)
		.where(and(eq(outboundJobs.status, "queued"), lte(outboundJobs.updatedAt, queuedBefore)))
		.orderBy(outboundJobs.updatedAt).limit(25);
	const expired = await db.select({ id: outboundJobs.id }).from(outboundJobs)
		.where(and(eq(outboundJobs.status, "processing"), lte(outboundJobs.updatedAt, expiredBefore)))
		.orderBy(outboundJobs.updatedAt).limit(10);
	for (const job of expired) await markOutboundUncertain(db, job.id, lte(outboundJobs.updatedAt, expiredBefore));
	if (due.length) await env.OUTBOUND_QUEUE.sendBatch(due.map(({ id, generation }) => ({ body: { kind: "outbound", jobId: id, generation } })));
}

export async function processOutboundQueue(
	env: CloudflareEnv,
	payload: OutboundQueueMessage,
	deliveryToken: string,
): Promise<OutboundQueueResult> {
	const db = getDb(env);
	const now = new Date();
	const [job] = await db
		.update(outboundJobs)
		.set({
			status: "processing",
			deliveryToken,
			attempts: sql`${outboundJobs.attempts} + 1`,
			lastAttemptAt: now,
			updatedAt: now,
			error: null,
		})
		.where(and(eq(outboundJobs.id, payload.jobId), eq(outboundJobs.status, "queued"), eq(outboundJobs.recoveryCount, payload.generation ?? 0)))
		.returning({
			id: outboundJobs.id,
			userId: outboundJobs.userId,
			messageId: outboundJobs.messageId,
			payload: outboundJobs.payload,
			status: outboundJobs.status,
			deliveryToken: outboundJobs.deliveryToken,
		});

	// A duplicate can arrive while the original invocation still owns the claim.
	// Only the reconciler can expire a claim left behind by a dead invocation.
	if (!job) return { action: "ack" };

	if (!job.messageId) {
		await markOutboundFailed(env, job.id, "Outbound message no longer exists");
		return { action: "ack" };
	}

	const snapshot = parseDeliverySnapshot(job.payload);
	if (!snapshot) {
		await markOutboundFailed(env, job.id, "Stored outbound payload is invalid");
		return { action: "ack" };
	}

	let loadedAttachments: ValidatedOutboundAttachment[] | null;
	try {
		loadedAttachments = await loadOutboundAttachments(
			env,
			snapshot.attachments,
			job.userId,
			job.messageId,
		);
	} catch {
		await db
			.update(outboundJobs)
			.set({
				status: "queued",
				error: "Attachment storage unavailable",
				deliveryToken: null,
				updatedAt: new Date(),
			})
			.where(and(
				eq(outboundJobs.id, job.id),
				eq(outboundJobs.status, "processing"),
				eq(outboundJobs.deliveryToken, deliveryToken),
			));
		return { action: "retry", delaySeconds: RETRY_DELAY_SECONDS };
	}
	if (!loadedAttachments) {
		await markOutboundFailed(env, job.id, "Stored outbound attachment is missing or corrupt");
		return { action: "ack" };
	}

	const outboundMessage = {
			from: snapshot.from,
			to: snapshot.to,
			subject: snapshot.subject,
			html: prepareHtmlForDelivery(snapshot.html),
			text: snapshot.text,
			...(snapshot.headers || snapshot.autoReply
				? {
					headers: {
						...(snapshot.headers ?? {}),
						...(snapshot.autoReply ? AUTO_REPLY_HEADERS : {}),
					},
				}
				: {}),
			...(loadedAttachments.length ? { attachments: loadedAttachments } : {}),
	};
	let response: OutboundSendResult;
	try {
		response = snapshot.externalAccountId
			? await sendExternalProviderMessage(
				env, job.userId, snapshot.externalAccountId, outboundMessage,
			)
			: await selectOutboundProvider(env).send({ ...outboundMessage, idempotencyKey: job.id });
	} catch (error) {
		if (error instanceof OutboundProviderError && error.outcomeUnknown) {
			await markOutboundUncertain(db, job.id, eq(outboundJobs.deliveryToken, deliveryToken));
			return { action: "ack" };
		}
		const failureMessage = providerFailureMessage(error);
		if (error instanceof OutboundProviderError && error.retryable) {
			await db
				.update(outboundJobs)
				.set({
					status: "queued",
					error: failureMessage,
					deliveryToken: null,
					updatedAt: new Date(),
				})
				.where(and(
					eq(outboundJobs.id, job.id),
					eq(outboundJobs.status, "processing"),
					eq(outboundJobs.deliveryToken, deliveryToken),
				));
			return { action: "retry", delaySeconds: RETRY_DELAY_SECONDS };
		}

		await markOutboundFailed(env, job.id, failureMessage);
		return { action: "ack" };
	}
	const claim = and(eq(outboundJobs.id, job.id), eq(outboundJobs.status, "processing"), eq(outboundJobs.deliveryToken, deliveryToken));
	await db.batch([
		db.update(messages).set({
			status: "sent", providerMessageId: response.providerMessageId,
			...(normalizeRfcMessageId(response.providerMessageId) ? { rfcMessageId: response.providerMessageId } : {}),
		}).where(and(eq(messages.id, job.messageId), exists(db.select({ id: outboundJobs.id }).from(outboundJobs).where(claim)))),
		db.update(outboundJobs).set({ status: "sent", error: null, deliveryToken: null, updatedAt: new Date() }).where(claim),
	]);
	await dispatchWebhooks(env, job.userId, "message.outbound", {
		messageId: job.messageId, providerMessageId: response.providerMessageId, to: snapshot.to,
	}, job.id).catch(() => console.warn("Outbound webhook scheduling failed", { jobId: job.id }));
	return { action: "ack" };
}

export async function processOutboundDeadLetter(
	env: CloudflareEnv,
	payload: OutboundQueueMessage,
): Promise<void> {
	await markOutboundFailed(env, payload.jobId, "Outbound delivery retries exhausted", and(
		eq(outboundJobs.status, "queued"), eq(outboundJobs.recoveryCount, payload.generation ?? 0),
	));
}
