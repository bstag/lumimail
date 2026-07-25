import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
	attachments,
	messageBodies,
	messages,
	messageFilters,
	messageLabels,
	vacationReplyLog,
	vacationResponders,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { buildSnippet, parseRawMime } from "@/lib/email/parse";
import { resolveInboundTargets, type ResolvedMailbox } from "@/lib/email/routing";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { getMessageContactNames, upsertContactFromAddress } from "@/lib/contacts/service";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import {
	isVacationAudienceAllowed,
	normalizeVacationAddress,
	shouldSuppressVacationReply,
	withinVacationReplyWindow,
} from "@/lib/email/vacation";
import { prepareInboundAttachments } from "@/lib/email/inbound-attachments";
import { resolveInboundThreading } from "@/lib/email/threading";

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
	parsed: Awaited<ReturnType<typeof parseRawMime>>,
	fromAddr: string,
	mailbox: ResolvedMailbox,
): Promise<void> {
	const messageId = newId("msg");
	const snippet = buildSnippet(parsed.text, parsed.html);
	const prepared = prepareInboundAttachments(parsed.attachments);
	const mailboxAddress = `${mailbox.localPart}@${mailbox.hostname}`;
	const mailboxHeader = formatEmailAddress(mailboxAddress, mailbox.displayName ?? mailbox.localPart);
	const toAddr = parsed.toAddr && getEmailAddress(parsed.toAddr).toLowerCase() !== mailboxAddress.toLowerCase()
		? parsed.toAddr
		: mailboxHeader;
	await upsertContactFromAddress(env, {
		userId: mailbox.userId,
		address: fromAddr,
		source: "inbound",
	});

	const attachmentRows = prepared.attachments.map((attachment) => {
		const id = newId("att");
		return {
			id,
			messageId,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
			r2Key: `attachments/${mailbox.userId}/${messageId}/${id}`,
			content: attachment.content,
		};
	});
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
	const attachmentInsert = attachmentRows.length
		? db.insert(attachments).values(
			attachmentRows.map((row) => ({
				id: row.id,
				messageId: row.messageId,
				filename: row.filename,
				contentType: row.contentType,
				size: row.size,
				r2Key: row.r2Key,
			})),
		)
		: null;

	const attemptedKeys: string[] = [];
	try {
		for (const attachment of attachmentRows) {
			attemptedKeys.push(attachment.r2Key);
			await env.BUCKET.put(attachment.r2Key, attachment.content, {
				httpMetadata: { contentType: attachment.contentType },
			});
		}
		await db.batch([
			messageInsert,
			bodyInsert,
			...(attachmentInsert ? [attachmentInsert] : []),
		]);
	} catch (error) {
		await cleanupInboundAttachmentObjects(env, attemptedKeys);
		throw error;
	}

	await applyMessageFilters(db, mailbox.userId, messageId, fromAddr, toAddr, parsed.subject ?? undefined);

	await dispatchWebhooks(env, mailbox.userId, "message.inbound", {
		messageId,
		from: fromAddr,
		to: toAddr,
		subject: parsed.subject,
	});

	await maybeVacationRespond(
		env,
		mailbox.userId,
		fromAddr,
		toAddr,
		parsed.subject ?? undefined,
		payload.headers ?? {},
		mailbox.organizationId,
		mailbox.mailboxId,
	);
}

async function cleanupInboundAttachmentObjects(
	env: CloudflareEnv,
	keys: string[],
): Promise<void> {
	if (keys.length === 0) return;
	try {
		await env.BUCKET.delete(keys.length === 1 ? keys[0] : keys);
	} catch {
		console.error("Failed to clean up inbound attachment objects");
	}
}

async function applyMessageFilters(
	db: ReturnType<typeof getDb>,
	userId: string,
	messageId: string,
	fromAddr: string,
	toAddr: string,
	subject: string | undefined,
) {
	const filters = await db
		.select()
		.from(messageFilters)
		.where(eq(messageFilters.userId, userId));

	for (const filter of filters) {
		if (!filter.enabled) continue;

		const matchesFrom = !filter.fromContains || fromAddr.includes(filter.fromContains);
		const matchesTo = !filter.toContains || toAddr.includes(filter.toContains);
		const matchesSubject = !filter.subjectContains || (subject ?? "").includes(filter.subjectContains);
		const matchesWords = !filter.hasWords || (subject ?? "").includes(filter.hasWords) || fromAddr.includes(filter.hasWords);

		if (!matchesFrom || !matchesTo || !matchesSubject || !matchesWords) continue;

		const updates: Partial<typeof messages.$inferSelect> = {};
		if (filter.actionStar) updates.starred = true;
		if (filter.actionMarkRead) updates.read = true;
		if (filter.actionMoveToTrash) updates.status = "trash";
		if (filter.actionArchive) updates.status = "archived" as string;

		if (Object.keys(updates).length > 0) {
			await db.update(messages).set(updates).where(eq(messages.id, messageId));
		}

		if (filter.actionLabelId) {
			await db.insert(messageLabels).values({ messageId, labelId: filter.actionLabelId }).onConflictDoNothing();
		}
	}
}

async function maybeVacationRespond(
	env: CloudflareEnv,
	userId: string,
	fromAddr: string,
	toAddr: string,
	subject: string | undefined,
	headers: Record<string, string>,
	organizationId: string | null,
	mailboxId: string,
) {
	// Header- and sender-based suppression comes first: it decides whether this
	// message may be answered at all, before any per-correspondent bookkeeping.
	const suppression = shouldSuppressVacationReply({ fromAddr, toAddr, headers });
	if (suppression) return;

	const db = getDb(env);
	const [responder] = await db
		.select()
		.from(vacationResponders)
		.where(eq(vacationResponders.mailboxId, mailboxId))
		.limit(1);

	if (!responder?.enabled) return;

	const now = new Date();
	if (responder.startDate && now < responder.startDate) return;
	if (responder.endDate && now > responder.endDate) return;

	const audienceAllowed = await isVacationAudienceAllowed(db, {
		userId,
		organizationId,
		fromAddr,
		responder,
	});
	if (!audienceAllowed) return;

	if (await withinVacationReplyWindow(db, mailboxId, fromAddr, now)) return;

	const { sendEmail } = await import("@/lib/email/send");
	try {
		await sendEmail(env, {
			userId,
			from: toAddr,
			to: fromAddr,
			subject: `Re: ${subject ?? ""} — ${responder.subject}`,
			text: responder.body,
			autoReply: true,
		});
	} catch {
		// vacation reply is best-effort
		return;
	}

	// Recorded only after a successful send, so a failed reply does not consume the
	// correspondent's window. A failure here means one possible duplicate later,
	// which is preferable to failing inbound delivery.
	try {
		await db
			.insert(vacationReplyLog)
			.values({
				id: newId("vrl"),
				mailboxId,
				senderAddress: normalizeVacationAddress(fromAddr),
				lastRepliedAt: now,
			})
			.onConflictDoUpdate({
				target: [vacationReplyLog.mailboxId, vacationReplyLog.senderAddress],
				set: { lastRepliedAt: now },
			});
	} catch {
		console.warn("Vacation reply log could not be updated");
	}
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

export async function getMessageWithBody(
	env: CloudflareEnv,
	userId: string,
	organizationId: string | null,
	messageId: string,
	mailboxId?: string,
) {
	const db = getDb(env);
	const [message] = await db
		.select()
		.from(messages)
		.where(and(
			eq(messages.id, messageId),
			...(mailboxId ? [eq(messages.mailboxId, mailboxId)] : []),
			messageAccessCondition(db, userId, organizationId, "read"),
		))
		.limit(1);
	if (!message) return null;
	const [body] = await db
		.select()
		.from(messageBodies)
		.where(eq(messageBodies.messageId, messageId))
		.limit(1);
	const contactNames = await getMessageContactNames(env, userId, message.fromAddr, message.toAddr);
	return { message: { ...message, ...contactNames }, body };
}
