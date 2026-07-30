import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, outboundJobs } from "@/db/schema";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { selectOutboundProvider } from "@/lib/email/providers";
import { AUTO_REPLY_HEADERS } from "@/lib/email/auto-reply";
import { OutboundProviderError } from "@/lib/email/providers/types";
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
): Promise<boolean> {
	const db = getDb(env);
	const [job] = await db
		.update(outboundJobs)
		.set({
			status: "failed",
			error: error.slice(0, MAX_STORED_ERROR_LENGTH),
			deliveryToken: null,
			updatedAt: new Date(),
		})
		.where(and(eq(outboundJobs.id, jobId), inArray(outboundJobs.status, ["queued", "processing"])))
		.returning({
			id: outboundJobs.id,
			userId: outboundJobs.userId,
			messageId: outboundJobs.messageId,
		});
	if (!job) return false;

	if (job.messageId) {
		await db.update(messages).set({ status: "failed" }).where(eq(messages.id, job.messageId));
		await dispatchWebhooks(env, job.userId, "message.failed", {
			messageId: job.messageId,
			error,
		});
	}
	return true;
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
		.where(and(eq(outboundJobs.id, payload.jobId), eq(outboundJobs.status, "queued")))
		.returning({
			id: outboundJobs.id,
			userId: outboundJobs.userId,
			messageId: outboundJobs.messageId,
			payload: outboundJobs.payload,
			status: outboundJobs.status,
			deliveryToken: outboundJobs.deliveryToken,
		});

	if (!job) {
		const [existing] = await db
			.select({
				status: outboundJobs.status,
				deliveryToken: outboundJobs.deliveryToken,
			})
			.from(outboundJobs)
			.where(eq(outboundJobs.id, payload.jobId))
			.limit(1);
		if (
			existing?.status === "processing" &&
			existing.deliveryToken === deliveryToken
		) {
			await markOutboundFailed(
				env,
				payload.jobId,
				"Outbound delivery outcome is unknown; automatic retry was stopped to prevent a duplicate",
			);
		}
		return { action: "ack" };
	}

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

	try {
		const response = await selectOutboundProvider(env).send({
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
		});
		await db.batch([
			db
				.update(outboundJobs)
				.set({
					status: "sent",
					error: null,
					deliveryToken: null,
					updatedAt: new Date(),
				})
				.where(and(
					eq(outboundJobs.id, job.id),
					eq(outboundJobs.status, "processing"),
					eq(outboundJobs.deliveryToken, deliveryToken),
				)),
			db
				.update(messages)
				.set({
					status: "sent",
					providerMessageId: response.providerMessageId,
					...(normalizeRfcMessageId(response.providerMessageId)
						? { rfcMessageId: response.providerMessageId }
						: {}),
				})
				.where(eq(messages.id, job.messageId)),
		]);
		await dispatchWebhooks(env, job.userId, "message.outbound", {
			messageId: job.messageId,
			providerMessageId: response.providerMessageId,
			to: snapshot.to,
		});
		return { action: "ack" };
	} catch (error) {
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
}

export async function processOutboundDeadLetter(
	env: CloudflareEnv,
	payload: OutboundQueueMessage,
): Promise<void> {
	await markOutboundFailed(env, payload.jobId, "Outbound delivery retries exhausted");
}
