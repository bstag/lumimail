import { and, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import {
	attachments,
	messageBodies,
	messages,
	outboundIdempotency,
	outboundJobs,
	securityAuditEvents,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { buildSnippet } from "@/lib/email/parse";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { upsertContactFromAddress } from "@/lib/contacts/service";
import { formatEmailAddress, getEmailAddress, getMailboxAddress } from "@/lib/email/address";
import {
	validateOutboundAttachments,
	type OutboundAttachmentInput,
} from "@/lib/email/outbound-attachments";
import {
	attachmentKey,
	cleanupAttachmentObjects,
} from "@/lib/email/attachment-storage";
import { buildReplyThreading, type ReplyThreading } from "@/lib/email/threading";
import { selectAccessibleReplySource } from "@/lib/email/reply-source";
import { buildReplyBodies, type ReplyBodySource } from "@/lib/email/reply-bodies";
import { normalizeAuthoredContent } from "@/lib/email/authored-content";
import {
	resolveSenderAuthorization,
	SenderNotAllowedError,
	type SenderAuthorization,
} from "@/lib/email/outbound/authorization";
import type {
	OutboundAttachmentSnapshot,
	OutboundDeliverySnapshot,
} from "@/lib/email/outbound/snapshot";
import { resolveExistingIdempotency } from "@/lib/mcp/idempotency";

export type SendEmailInput = {
	userId: string;
	from: string;
	to: string;
	subject: string;
	html?: string;
	text?: string;
	mailboxId?: string;
	attachments?: OutboundAttachmentInput[];
	replyToMessageId?: string;
	/**
	 * Marks this as an automatic reply (F64). Only a flag is carried, never the
	 * headers themselves, so the stored payload stays un-injectable and the
	 * consumer applies the fixed AUTO_REPLY_HEADERS constant from code.
	 */
	autoReply?: boolean;
	idempotency?: {
		principalType: "mcp";
		principalId: string;
		key: string;
		requestHash: string;
		audit?: {
			organizationId: string;
			actorUserId: string;
			requestId: string;
		};
	};
};

export class ReplySourceNotAllowedError extends Error {
	constructor() {
		super("Reply source is not accessible in the selected mailbox");
		this.name = "ReplySourceNotAllowedError";
	}
}

async function resolveReplySource(
	env: CloudflareEnv,
	input: SendEmailInput,
	authorization: SenderAuthorization,
): Promise<{
	threadId: string;
	replySourceMessageId: string;
	threading: ReplyThreading;
	bodySource: ReplyBodySource;
} | null> {
	if (!input.replyToMessageId) return null;
	const db = getDb(env);
	const source = await selectAccessibleReplySource(
		db,
		input.userId,
		authorization.organizationId,
		authorization.mailboxId,
		input.replyToMessageId,
	);
	if (!source) throw new ReplySourceNotAllowedError();
	return {
		threadId: source.threadId ?? newId("thr"),
		replySourceMessageId: source.id,
		threading: buildReplyThreading(source),
		bodySource: source,
	};
}

/**
 * Derives the canonical From header from the authorized mailbox identity.
 *
 * Authorization already proved the mailbox, so the address is normally
 * re-formatted with the mailbox display name. The requested `from` string is
 * kept verbatim only when it does not reduce to the mailbox address — e.g. a
 * bare `<user@host>` form, which the address parser matches for authorization
 * but the display-name parser leaves intact.
 */
function resolveFromAddress(from: string, authorization: SenderAuthorization): string {
	const requestedAddress = getEmailAddress(from);
	const mailboxAddress = getMailboxAddress(authorization);
	if (requestedAddress.toLowerCase() !== mailboxAddress.toLowerCase()) {
		return from;
	}
	return formatEmailAddress(
		mailboxAddress,
		authorization.displayName ?? authorization.localPart,
	);
}

/**
 * Marks a persisted job (and its message) failed after the delivery queue
 * rejected the enqueue. Shared by the producer (`sendEmail`) and the operator
 * recovery path (`recoverOutboundJob`), whose compensation is identical.
 */
export async function failJobQueueUnavailable(
	db: AppDatabase,
	jobId: string,
	messageId: string,
): Promise<void> {
	await db.batch([
		db
			.update(outboundJobs)
			.set({ status: "failed", error: "Queue unavailable", updatedAt: new Date() })
			.where(eq(outboundJobs.id, jobId)),
		db.update(messages).set({ status: "failed" }).where(eq(messages.id, messageId)),
	]);
}

export async function sendEmail(
	env: CloudflareEnv,
	input: SendEmailInput,
): Promise<{ messageId: string; status: "queued" | "sent" | "failed"; replayed?: true }> {
	const db = getDb(env);
	const authorization = await resolveSenderAuthorization(env, input.userId, input.from, input.mailboxId);
	if (!authorization) {
		throw new SenderNotAllowedError(input.from);
	}
	async function readExistingIdempotency() {
		if (!input.idempotency) return null;
		const [existing] = await db
			.select({
				requestHash: outboundIdempotency.requestHash,
				messageId: outboundIdempotency.messageId,
				status: messages.status,
			})
			.from(outboundIdempotency)
			.innerJoin(messages, eq(messages.id, outboundIdempotency.messageId))
			.where(and(
				eq(outboundIdempotency.principalType, input.idempotency.principalType),
				eq(outboundIdempotency.principalId, input.idempotency.principalId),
				eq(outboundIdempotency.idempotencyKey, input.idempotency.key),
			))
			.limit(1);
		if (!existing) return null;
		const status = existing.status === "sent" || existing.status === "failed" ? existing.status : "queued";
		return resolveExistingIdempotency({ ...existing, status }, input.idempotency.requestHash);
	}
	const replay = await readExistingIdempotency();
	if (replay) return replay;

	const replySource = await resolveReplySource(env, input, authorization);
	const fromAddr = resolveFromAddress(input.from, authorization);
	const authoredContent = normalizeAuthoredContent(input, { allowInlineImages: true });
	const deliveryBodies = replySource
		? buildReplyBodies(
			authoredContent.text ?? "",
			replySource.bodySource,
			authoredContent.html,
		)
		: authoredContent;
	const validatedAttachments = validateOutboundAttachments(input);
	await upsertContactFromAddress(env, {
		userId: input.userId,
		address: input.to,
		source: "outbound",
	});
	const messageId = newId("msg");
	const snippet = buildSnippet(deliveryBodies.text ?? null, deliveryBodies.html ?? null);

	const jobId = newId("job");
	const attachmentSnapshots: OutboundAttachmentSnapshot[] = validatedAttachments.map((attachment) => {
		const id = newId("att");
		return {
			id,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
			r2Key: attachmentKey(input.userId, messageId, id),
			disposition: attachment.disposition,
			...(attachment.contentId ? { contentId: attachment.contentId } : {}),
		};
	});
	const snapshot: OutboundDeliverySnapshot = {
		from: fromAddr,
		to: input.to,
		subject: input.subject,
		html: deliveryBodies.html ?? undefined,
		text: deliveryBodies.text ?? undefined,
		...(attachmentSnapshots.length ? { attachments: attachmentSnapshots } : {}),
		...(replySource?.threading.headers ? { headers: replySource.threading.headers } : {}),
		...(input.autoReply ? { autoReply: true } : {}),
	};
	const messageInsert = db.insert(messages).values({
		id: messageId,
		userId: input.userId,
		organizationId: authorization.organizationId,
		mailboxId: authorization.mailboxId,
		direction: "outbound",
		fromAddr,
		toAddr: input.to,
		subject: input.subject,
		snippet,
		status: "queued",
		attachmentStatus: attachmentSnapshots.length ? "stored" : "none",
		threadId: replySource?.threadId ?? newId("thr"),
		inReplyTo: replySource?.threading.inReplyTo ?? null,
		referencesHeader: replySource?.threading.referencesHeader ?? null,
		replySourceMessageId: replySource?.replySourceMessageId ?? null,
	});
	const bodyInsert = db.insert(messageBodies).values({
		id: newId(),
		messageId,
		textBody: deliveryBodies.text ?? null,
		htmlBody: deliveryBodies.html ?? null,
	});
	const jobInsert = db.insert(outboundJobs).values({
		id: jobId,
		userId: input.userId,
		organizationId: authorization.organizationId,
		messageId,
		status: "queued",
		payload: JSON.stringify(snapshot),
	});
	const attachmentInsert = attachmentSnapshots.length
		? db.insert(attachments).values(attachmentSnapshots.map((attachment) => ({
			id: attachment.id,
			messageId,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
			r2Key: attachment.r2Key,
			disposition: attachment.disposition,
			contentId: attachment.contentId ?? null,
		})))
		: null;
	const idempotencyInsert = input.idempotency
		? db.insert(outboundIdempotency).values({
			id: newId("idem"),
			principalType: input.idempotency.principalType,
			principalId: input.idempotency.principalId,
			idempotencyKey: input.idempotency.key,
			requestHash: input.idempotency.requestHash,
			messageId,
			jobId,
		})
		: null;
	const mutationAuditInsert = input.idempotency?.audit
		? db.insert(securityAuditEvents).values({
			id: newId("aud"),
			organizationId: input.idempotency.audit.organizationId,
			actorUserId: input.idempotency.audit.actorUserId,
			action: "mcp.mutate",
			resourceType: "mcp_connection",
			resourceId: input.idempotency.principalId,
			affectedCount: 1,
			requestId: input.idempotency.audit.requestId,
			outcome: "succeeded",
		})
		: null;

	const writtenKeys: string[] = [];
	try {
		for (let index = 0; index < validatedAttachments.length; index += 1) {
			const attachment = validatedAttachments[index];
			const metadata = attachmentSnapshots[index];
			writtenKeys.push(metadata.r2Key);
			await env.BUCKET.put(metadata.r2Key, attachment.content, {
				httpMetadata: { contentType: attachment.contentType },
			});
		}
		await db.batch([
			messageInsert,
			bodyInsert,
			jobInsert,
			...(attachmentInsert ? [attachmentInsert] : []),
			...(idempotencyInsert ? [idempotencyInsert] : []),
			...(mutationAuditInsert ? [mutationAuditInsert] : []),
		]);
	} catch (error) {
		await cleanupAttachmentObjects(env, writtenKeys);
		const winner = await readExistingIdempotency();
		if (winner) return winner;
		throw error;
	}

	try {
		await env.OUTBOUND_QUEUE.send({ kind: "outbound", jobId });
		return { messageId, status: "queued" };
	} catch (error) {
		await failJobQueueUnavailable(db, jobId, messageId);
		await dispatchWebhooks(env, input.userId, "message.failed", {
			messageId,
			error: "Queue unavailable",
		});
		throw error;
	}
}
