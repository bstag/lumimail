import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
	inboundDeliveries,
	messageBodies,
	messages,
	pushNotificationEvents,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { buildSnippet, unsubscribeColumns, parseRawMime, type ParsedEmail } from "@/lib/email/parse";
import { resolveInboundTargets, type ResolvedMailbox } from "@/lib/email/routing";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { upsertContactFromAddress } from "@/lib/contacts/service";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { applyMessageFilters } from "@/lib/email/message-filters";
import { maybeVacationRespond } from "@/lib/email/vacation-responder";
import { buildInboundAttachmentRows, inboundAttachmentInserts, prepareInboundAttachments } from "@/lib/email/inbound-attachments";
import { cleanupAttachmentObjects } from "@/lib/email/attachment-storage";
import { resolveInboundThreading } from "@/lib/email/threading";
import { advanceInboundDelivery, readInboundDelivery } from "./inbound-delivery";

export type InboundQueueMessage = {
	from: string;
	to: string;
	rawR2Key: string;
	headers?: Record<string, string>;
};

export async function processInboundMessage(
	env: CloudflareEnv,
	payload: InboundQueueMessage,
): Promise<void> {
	const db = getDb(env);
	const decisions = await resolveInboundTargets(db, payload.to);

	if (decisions.length === 0) {
		console.warn(`No routing for inbound address: ${payload.to}`);
		return;
	}

	const mailboxTargets = decisions
		.filter((d) => d.action === "store" && d.mailbox)
		.map((d) => d.mailbox as ResolvedMailbox);

	// Forwarding is performed at receive time in the Worker's `email()` handler,
	// because `message.forward()` is only available on the live inbound message.
	// This consumer is responsible for storage decisions only.
	for (const decision of decisions) {
		if (decision.action === "reject") console.warn(`Rejected inbound: ${payload.to}`);
	}

	if (mailboxTargets.length === 0) return;

	const raw = await env.BUCKET.get(payload.rawR2Key);
	if (!raw) {
		console.error(`Missing R2 object: ${payload.rawR2Key}`);
		return;
	}

	const buffer = await raw.arrayBuffer();
	const parsed = await parseRawMime(buffer);
	const fromAddr = parsed.fromAddr ?? payload.from;

	for (const mailbox of mailboxTargets) {
		await deliverToMailbox(env, db, payload, parsed, fromAddr, mailbox);
	}

	// The raw copy is redundant once the body, HTML, and attachments are extracted,
	// and nothing reads it back (F63). Clear the references first so no row can name
	// an object that no longer exists; a failed delete is caught by the sweep.
	await db
		.update(messageBodies)
		.set({ rawR2Key: null })
		.where(eq(messageBodies.rawR2Key, payload.rawR2Key));
	try {
		await env.BUCKET.delete(payload.rawR2Key);
	} catch {
		console.warn("Raw inbound object could not be deleted", { key: payload.rawR2Key });
	}
}

async function deliverToMailbox(
	env: CloudflareEnv,
	db: ReturnType<typeof getDb>,
	payload: InboundQueueMessage,
	parsed: ParsedEmail,
	fromAddr: string,
	mailbox: ResolvedMailbox,
): Promise<void> {
	const key = { rawR2Key: payload.rawR2Key, mailboxId: mailbox.mailboxId };
	const existing = await readInboundDelivery(db, key);
	const mailboxAddress = `${mailbox.localPart}@${mailbox.hostname}`;
	const mailboxHeader = formatEmailAddress(mailboxAddress, mailbox.displayName ?? mailbox.localPart);
	const toAddr = parsed.toAddr && getEmailAddress(parsed.toAddr).toLowerCase() !== mailboxAddress.toLowerCase()
		? parsed.toAddr
		: mailboxHeader;
	const delivery = existing ?? await storeMailboxDelivery(env, db, payload, parsed, fromAddr, toAddr, mailbox);
	if (delivery.stage === "complete") return;
	if (!delivery.messageId) {
		await advanceInboundDelivery(db, key, delivery.stage, "complete");
		return;
	}
	const { messageId, createdAt, pushEventId } = delivery;

	if (delivery.stage === "filters") {
		await applyMessageFilters(db, mailbox.userId, messageId, createdAt);
		await advanceInboundDelivery(db, key, "filters", "webhooks");
	}
	if (pushEventId) {
		try {
			await env.PUSH_QUEUE.send({ kind: "push-expand", version: 1, eventId: pushEventId });
		} catch {
			// Reconciliation can wake the durable event after a failed queue send.
			console.warn("Push event enqueue deferred", { eventId: pushEventId });
		}
	}
	await dispatchWebhooks(env, mailbox.userId, "message.inbound", {
		messageId,
		from: fromAddr,
		to: toAddr,
		subject: parsed.subject,
	}, messageId);

	if (await advanceInboundDelivery(db, key, "webhooks", "complete")) {
		await maybeVacationRespond(env, {
			userId: mailbox.userId,
			fromAddr,
			toAddr,
			subject: parsed.subject ?? undefined,
			headers: payload.headers ?? {},
			organizationId: mailbox.organizationId,
			mailboxId: mailbox.mailboxId,
		}).catch(() => console.warn("Inbound vacation reply failed"));
	}
}

async function storeMailboxDelivery(
	env: CloudflareEnv,
	db: ReturnType<typeof getDb>,
	payload: InboundQueueMessage,
	parsed: ParsedEmail,
	fromAddr: string,
	toAddr: string,
	mailbox: ResolvedMailbox,
) {
	const messageId = newId("msg");
	const now = new Date();
	const snippet = buildSnippet(parsed.text, parsed.html);
	const prepared = prepareInboundAttachments(parsed.attachments);
	await upsertContactFromAddress(env, {
		userId: mailbox.userId,
		address: fromAddr,
		source: "inbound",
	});

	const attachmentRows = buildInboundAttachmentRows(mailbox.userId, messageId, prepared.attachments);
	const threading = await resolveInboundThreading({
		mailboxId: mailbox.mailboxId,
		messageId: parsed.messageId,
		inReplyTo: parsed.inReplyTo,
		references: parsed.references,
		fallbackThreadId: () => newId("thr"),
		findAncestor: async (candidates) => {
			const rows = await db
				.select({
					rfcMessageId: messages.rfcMessageId,
					providerMessageId: messages.providerMessageId,
					threadId: messages.threadId,
				})
				.from(messages)
				.where(and(
					eq(messages.mailboxId, mailbox.mailboxId),
					or(
						inArray(messages.rfcMessageId, candidates),
						inArray(messages.providerMessageId, candidates),
					),
				));
			for (const candidate of candidates) {
				const match = rows.find((row) =>
					row.rfcMessageId === candidate || row.providerMessageId === candidate
				);
				if (match) return { threadId: match.threadId };
			}
			return null;
		},
	});
	const messageInsert = db.insert(messages).values({
		id: messageId,
		userId: mailbox.userId,
		organizationId: mailbox.organizationId,
		mailboxId: mailbox.mailboxId,
		direction: "inbound",
		providerMessageId: threading.rfcMessageId,
		rfcMessageId: threading.rfcMessageId,
		inReplyTo: threading.inReplyTo,
		referencesHeader: threading.referencesHeader,
		fromAddr,
		toAddr,
		subject: parsed.subject,
		snippet,
		status: "received",
		threadId: threading.threadId,
		receivedAt: parsed.receivedAt ?? now,
		createdAt: now,
		...unsubscribeColumns(parsed),
		attachmentStatus: prepared.status,
		attachmentError: prepared.error,
	});

	const bodyInsert = db.insert(messageBodies).values({
		id: newId(),
		messageId,
		textBody: parsed.text,
		htmlBody: parsed.html,
		rawR2Key: payload.rawR2Key,
	});
	const pushEventId = mailbox.organizationId ? newId("pue") : null;
	const pushEventInsert = pushEventId && mailbox.organizationId
		? db.insert(pushNotificationEvents).values({
			id: pushEventId,
			organizationId: mailbox.organizationId,
			mailboxId: mailbox.mailboxId,
			messageId,
			status: "pending",
			attempts: 0,
			nextAttemptAt: now,
			createdAt: now,
		})
		: null;
	const delivery = {
		rawR2Key: payload.rawR2Key,
		mailboxId: mailbox.mailboxId,
		messageId,
		stage: "filters" as const,
		createdAt: now,
		pushEventId,
	};

	const attemptedKeys: string[] = [];
	try {
		for (const { row, content } of attachmentRows) {
			attemptedKeys.push(row.r2Key);
			await env.BUCKET.put(row.r2Key, content, {
				httpMetadata: { contentType: row.contentType },
			});
		}
		await db.batch([
			messageInsert,
			bodyInsert,
			...inboundAttachmentInserts(db, attachmentRows),
			...(pushEventInsert ? [pushEventInsert] : []),
			db.insert(inboundDeliveries).values(delivery),
		]);
	} catch (error) {
		await cleanupAttachmentObjects(env, attemptedKeys);
		throw error;
	}

	return delivery;
}

export async function storeRawToR2(
	env: CloudflareEnv,
	from: string,
	to: string,
	raw: ReadableStream<Uint8Array>,
): Promise<string> {
	const key = `inbound/${Date.now()}-${newId()}.eml`;
	const buffer = await new Response(raw).arrayBuffer();
	await env.BUCKET.put(key, buffer, {
		httpMetadata: { contentType: "message/rfc822" },
		customMetadata: { from, to },
	});
	return key;
}
