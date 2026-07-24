import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
	attachments,
	messageBodies,
	messages,
	messageFilters,
	messageLabels,
	vacationResponders,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { buildSnippet, parseRawMime } from "@/lib/email/parse";
import { resolveInboundTargets, type ResolvedMailbox } from "@/lib/email/routing";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { getMessageContactNames, upsertContactFromAddress } from "@/lib/contacts/service";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { prepareInboundAttachments } from "@/lib/email/inbound-attachments";

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

	for (const decision of decisions) {
		if (decision.action === "reject") console.warn(`Rejected inbound: ${payload.to}`);
		if (decision.action === "forward" && decision.forwardTo) {
			console.info(`Forward ${payload.to} -> ${decision.forwardTo}`);
		}
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
	const messageInsert = db.insert(messages).values({
		id: messageId,
		userId: mailbox.userId,
		organizationId: mailbox.organizationId,
		mailboxId: mailbox.mailboxId,
		direction: "inbound",
		providerMessageId: parsed.messageId,
		fromAddr,
		toAddr,
		subject: parsed.subject,
		snippet,
		status: "received",
		threadId: parsed.messageId,
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

	await maybeVacationRespond(env, mailbox.userId, fromAddr, toAddr, parsed.subject ?? undefined);
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
) {
	if (fromAddr.toLowerCase().includes("noreply") || fromAddr.toLowerCase().includes("no-reply")) return;

	const db = getDb(env);
	const [responder] = await db
		.select()
		.from(vacationResponders)
		.where(eq(vacationResponders.userId, userId))
		.limit(1);

	if (!responder?.enabled) return;

	const now = new Date();
	if (responder.startDate && now < responder.startDate) return;
	if (responder.endDate && now > responder.endDate) return;

	const { sendEmail } = await import("@/lib/email/send");
	try {
		await sendEmail(env, {
			userId,
			from: toAddr,
			to: fromAddr,
			subject: `Re: ${subject ?? ""} — ${responder.subject}`,
			text: responder.body,
		});
	} catch {
		// vacation reply is best-effort
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
