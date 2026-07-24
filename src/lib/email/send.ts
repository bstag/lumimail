import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
	attachments,
	domains,
	mailboxMemberships,
	mailboxes,
	messageBodies,
	messages,
	outboundJobs,
	users,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { buildSnippet } from "@/lib/email/parse";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { selectOutboundProvider } from "@/lib/email/providers";
import { OutboundProviderError } from "@/lib/email/providers/types";
import { upsertContactFromAddress } from "@/lib/contacts/service";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { parseAddress } from "@/lib/utils";
import {
	validateOutboundAttachments,
	type OutboundAttachmentInput,
	type ValidatedOutboundAttachment,
} from "@/lib/email/outbound-attachments";
import {
	buildReplyThreading,
	normalizeRfcMessageId,
	type ReplyThreading,
} from "@/lib/email/threading";
import { selectAccessibleReplySource } from "@/lib/email/reply-source";

async function getUserOrgId(env: CloudflareEnv, userId: string): Promise<string | null> {
	const db = getDb(env);
	const [user] = await db
		.select({ organizationId: users.organizationId })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	return user?.organizationId ?? null;
}

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
};

type OutboundAttachmentSnapshot = {
	id: string;
	filename: string;
	contentType: string;
	size: number;
	r2Key: string;
};

type OutboundDeliverySnapshot = {
	from: string;
	to: string;
	subject: string;
	html?: string;
	text?: string;
	attachments?: OutboundAttachmentSnapshot[];
	headers?: NonNullable<ReplyThreading["headers"]>;
};

export type OutboundQueueMessage = {
	kind: "outbound";
	jobId: string;
};

export type OutboundQueueResult =
	| { action: "ack" }
	| { action: "retry"; delaySeconds: number };

type SenderAuthorization = { mailboxId: string; organizationId: string | null };

export class SenderNotAllowedError extends Error {
	constructor(from: string) {
		super(`Sender address is not an active mailbox for your account: ${from}`);
		this.name = "SenderNotAllowedError";
	}
}

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
	};
}

async function cleanupAttachmentObjects(env: CloudflareEnv, keys: string[]): Promise<void> {
	await Promise.all(keys.map(async (key) => {
		try {
			await env.BUCKET.delete(key);
		} catch {
			console.error("Failed to clean up an outbound attachment object");
		}
	}));
}

async function resolveSenderAuthorization(
	env: CloudflareEnv,
	userId: string,
	from: string,
	mailboxId?: string,
): Promise<SenderAuthorization | null> {
	const parsed = parseAddress(from);
	if (!parsed) return null;
	const db = getDb(env);
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.hostname, parsed.domain), eq(domains.status, "active")))
		.limit(1);
	if (!domain) return null;

	const orgId = await getUserOrgId(env, userId);
	const baseConditions = [
		eq(mailboxes.domainId, domain.id),
		eq(mailboxes.localPart, parsed.local),
		...(mailboxId ? [eq(mailboxes.id, mailboxId)] : []),
	];
	const mailboxQuery = db.select({ id: mailboxes.id }).from(mailboxes);
	const [mailbox] = orgId
		? await mailboxQuery
			.innerJoin(mailboxMemberships, eq(mailboxMemberships.mailboxId, mailboxes.id))
			.where(and(
				...baseConditions,
				eq(mailboxes.organizationId, orgId),
				eq(mailboxMemberships.userId, userId),
				inArray(mailboxMemberships.role, ["responder", "manager"]),
			))
			.limit(1)
		: await mailboxQuery
			.where(and(...baseConditions, eq(mailboxes.userId, userId)))
			.limit(1);

	if (!mailbox) return null;

	await ensureEmailRoutingRuleToWorker(env, domain.zoneId, `${parsed.local}@${parsed.domain}`);
	return { mailboxId: mailbox.id, organizationId: orgId };
}

export async function validateSenderDomain(
	env: CloudflareEnv,
	userId: string,
	from: string,
	mailboxId?: string,
): Promise<boolean> {
	return !!await resolveSenderAuthorization(env, userId, from, mailboxId);
}

export async function sendEmail(
	env: CloudflareEnv,
	input: SendEmailInput,
): Promise<{ messageId: string; status: "queued" }> {
	const db = getDb(env);
	const authorization = await resolveSenderAuthorization(env, input.userId, input.from, input.mailboxId);
	if (!authorization) {
		throw new SenderNotAllowedError(input.from);
	}

	const replySource = await resolveReplySource(env, input, authorization);
	const authorizedInput = { ...input, mailboxId: authorization.mailboxId };
	const sender = await getSenderContext(env, authorizedInput);
	const fromAddr = sender.fromAddr;
	const validatedAttachments = validateOutboundAttachments(input);
	await upsertContactFromAddress(env, {
		userId: input.userId,
		address: input.to,
		source: "outbound",
	});
	const messageId = newId("msg");
	const snippet = buildSnippet(input.text ?? null, input.html ?? null);

	const jobId = newId("job");
	const attachmentSnapshots: OutboundAttachmentSnapshot[] = validatedAttachments.map((attachment) => {
		const id = newId("att");
		return {
			id,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
			r2Key: `attachments/${input.userId}/${messageId}/${id}`,
		};
	});
	const snapshot: OutboundDeliverySnapshot = {
		from: fromAddr,
		to: input.to,
		subject: input.subject,
		html: input.html,
		text: input.text,
		...(attachmentSnapshots.length ? { attachments: attachmentSnapshots } : {}),
		...(replySource?.threading.headers ? { headers: replySource.threading.headers } : {}),
	};
	const messageInsert = db.insert(messages).values({
		id: messageId,
		userId: input.userId,
		organizationId: sender.organizationId,
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
		textBody: input.text ?? null,
		htmlBody: input.html ?? null,
	});
	const jobInsert = db.insert(outboundJobs).values({
		id: jobId,
		userId: input.userId,
		organizationId: sender.organizationId,
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
		})))
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
		]);
	} catch (error) {
		await cleanupAttachmentObjects(env, writtenKeys);
		throw error;
	}

	try {
		await env.OUTBOUND_QUEUE.send({ kind: "outbound", jobId });
		return { messageId, status: "queued" };
	} catch (error) {
		const failureMessage = "Queue unavailable";
		await db.batch([
			db
				.update(outboundJobs)
				.set({ status: "failed", error: failureMessage, updatedAt: new Date() })
				.where(eq(outboundJobs.id, jobId)),
			db.update(messages).set({ status: "failed" }).where(eq(messages.id, messageId)),
		]);
		await dispatchWebhooks(env, input.userId, "message.failed", {
			messageId,
			error: failureMessage,
		});
		throw error;
	}
}

async function getSenderContext(
	env: CloudflareEnv,
	input: SendEmailInput & { mailboxId: string },
): Promise<{ fromAddr: string; organizationId: string | null }> {
	const db = getDb(env);
	const orgId = await getUserOrgId(env, input.userId);
	const [mailbox] = await db
		.select({
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			hostname: domains.hostname,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.leftJoin(mailboxMemberships, eq(mailboxMemberships.mailboxId, mailboxes.id))
		.where(
			and(
				eq(mailboxes.id, input.mailboxId),
				orgId
					? and(
						eq(mailboxes.organizationId, orgId),
						eq(mailboxMemberships.userId, input.userId),
						inArray(mailboxMemberships.role, ["responder", "manager"]),
					)
					: eq(mailboxes.userId, input.userId),
			),
		)
		.limit(1);

	if (!mailbox) return { fromAddr: input.from, organizationId: orgId };

	const requestedAddress = getEmailAddress(input.from);
	const mailboxAddress = `${mailbox.localPart}@${mailbox.hostname}`;
	if (requestedAddress.toLowerCase() !== mailboxAddress.toLowerCase()) {
		return { fromAddr: input.from, organizationId: orgId };
	}

	return {
		fromAddr: formatEmailAddress(mailboxAddress, mailbox.displayName ?? mailbox.localPart),
		organizationId: orgId,
	};
}

function parseDeliverySnapshot(payload: string): OutboundDeliverySnapshot | null {
	try {
		const value = JSON.parse(payload) as Record<string, unknown>;
		if (
			typeof value !== "object" ||
			value === null ||
			typeof value.from !== "string" ||
			typeof value.to !== "string" ||
			typeof value.subject !== "string" ||
			(value.html !== undefined && typeof value.html !== "string") ||
			(value.text !== undefined && typeof value.text !== "string") ||
			(value.headers !== undefined && !isThreadingHeaders(value.headers)) ||
			(value.attachments !== undefined && !isAttachmentSnapshotArray(value.attachments))
		) {
			return null;
		}
		return {
			from: value.from,
			to: value.to,
			subject: value.subject,
			html: value.html as string | undefined,
			text: value.text as string | undefined,
			headers: value.headers as NonNullable<ReplyThreading["headers"]> | undefined,
			attachments: value.attachments as OutboundAttachmentSnapshot[] | undefined,
		};
	} catch {
		return null;
	}
}

function isThreadingHeaders(value: unknown): value is NonNullable<ReplyThreading["headers"]> {
	if (typeof value !== "object" || value === null) return false;
	const headers = value as Record<string, unknown>;
	return (
		typeof headers["In-Reply-To"] === "string"
		&& typeof headers.References === "string"
		&& normalizeRfcMessageId(headers["In-Reply-To"]) === headers["In-Reply-To"]
		&& buildReplyThreading({
			rfcMessageId: headers["In-Reply-To"],
			providerMessageId: null,
			referencesHeader: headers.References,
		}).referencesHeader === headers.References
	);
}

function isAttachmentSnapshotArray(value: unknown): value is OutboundAttachmentSnapshot[] {
	return Array.isArray(value) && value.length <= 10 && value.every((attachment) =>
		typeof attachment === "object" &&
		attachment !== null &&
		typeof attachment.id === "string" &&
		typeof attachment.filename === "string" &&
		typeof attachment.contentType === "string" &&
		typeof attachment.size === "number" &&
		Number.isInteger(attachment.size) &&
		attachment.size >= 0 &&
		typeof attachment.r2Key === "string"
	);
}

async function loadOutboundAttachments(
	env: CloudflareEnv,
	snapshots: OutboundAttachmentSnapshot[] | undefined,
	userId: string,
	messageId: string,
): Promise<ValidatedOutboundAttachment[] | null> {
	if (!snapshots?.length) return [];
	const loaded: ValidatedOutboundAttachment[] = [];
	for (const snapshot of snapshots) {
		if (snapshot.r2Key !== `attachments/${userId}/${messageId}/${snapshot.id}`) return null;
		const object = await env.BUCKET.get(snapshot.r2Key);
		if (!object || object.size !== snapshot.size) return null;
		const content = await object.arrayBuffer();
		if (content.byteLength !== snapshot.size) return null;
		loaded.push({
			filename: snapshot.filename,
			contentType: snapshot.contentType,
			size: snapshot.size,
			content,
		});
	}
	return loaded;
}

function providerFailureMessage(error: unknown): string {
	if (!(error instanceof OutboundProviderError)) return "Outbound provider failed";
	const message = error.message.slice(0, 400);
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
			error: error.slice(0, 500),
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
		return { action: "retry", delaySeconds: 30 };
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
			html: snapshot.html,
			text: snapshot.text,
			...(snapshot.headers ? { headers: snapshot.headers } : {}),
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
			return { action: "retry", delaySeconds: 30 };
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
