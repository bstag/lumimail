import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
	attachments,
	externalMessages,
	externalOriginals,
	messageBodies,
	messages,
} from "@/db/schema";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { attachmentKey, cleanupAttachmentObjects } from "@/lib/email/attachment-storage";
import { prepareInboundAttachments } from "@/lib/email/inbound-attachments";
import { buildSnippet, parseRawMime } from "@/lib/email/parse";
import { resolveInboundThreading } from "@/lib/email/threading";
import { newId } from "@/lib/ids";
import type { ExternalRemoteChange } from "./provider-client";

type ExternalImportAccount = {
	id: string;
	organizationId: string;
	mailboxId: string;
	ownerUserId: string;
	provider: "google" | "microsoft";
	retainOriginal: boolean;
};

type ExternalImportMailbox = {
	id: string;
	userId: string;
	organizationId: string | null;
	localPart: string;
	displayName: string | null;
	hostname: string;
};

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes)));
	return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function persistExternalMessage(
	env: CloudflareEnv,
	account: ExternalImportAccount,
	mailbox: ExternalImportMailbox,
	change: ExternalRemoteChange,
	now = new Date(),
): Promise<
	| { status: "created" | "existing" | "removed"; messageId: string }
	| { status: "ignored" }
> {
	const db = getDb(env);
	const [existing] = await db.select({
		id: externalMessages.id,
		lumimailMessageId: externalMessages.lumimailMessageId,
	}).from(externalMessages).where(and(
		eq(externalMessages.accountId, account.id),
		eq(externalMessages.remoteMessageId, change.remoteMessageId),
	)).limit(1);

	if (existing) {
		await db.update(externalMessages).set({
			remoteFolderKey: change.remoteFolderKey,
			remoteRevision: change.remoteRevision,
			lastSeenAt: now,
			removedAt: change.removed ? now : null,
		}).where(eq(externalMessages.id, existing.id));
		return {
			status: change.removed ? "removed" : "existing",
			messageId: existing.lumimailMessageId,
		};
	}
	if (change.removed) return { status: "ignored" };
	if (!change.rawMime) throw new Error("External message MIME is missing");

	const parsed = await parseRawMime(exactArrayBuffer(change.rawMime));
	const newMessageId = newId("msg");
	const externalMessageId = newId("exm");
	if (change.remoteFolderKey === "sent") {
		const candidates = await db.select({ id: messages.id }).from(messages).where(and(
			eq(messages.mailboxId, mailbox.id),
			eq(messages.direction, "outbound"),
			eq(messages.status, "sent"),
			or(
				eq(messages.providerMessageId, change.remoteMessageId),
				...(parsed.messageId ? [eq(messages.rfcMessageId, parsed.messageId)] : []),
			),
		)).limit(2);
		if (candidates.length === 1) {
			const messageId = candidates[0].id;
			const mappingInsert = db.insert(externalMessages).values({
				id: externalMessageId,
				accountId: account.id,
				remoteMessageId: change.remoteMessageId,
				remoteThreadId: change.remoteThreadId,
				remoteFolderKey: change.remoteFolderKey,
				lumimailMessageId: messageId,
				remoteRevision: change.remoteRevision,
				firstSeenAt: now,
				lastSeenAt: now,
			});
			let originalInsert: ReturnType<ReturnType<typeof db.insert>["values"]> | null = null;
			let originalKey: string | null = null;
			if (account.retainOriginal) {
				originalKey = `external-originals/${account.organizationId}/${account.id}/${externalMessageId}.eml`;
				await env.BUCKET.put(originalKey, change.rawMime, {
					httpMetadata: { contentType: "message/rfc822" },
				});
				originalInsert = db.insert(externalOriginals).values({
					id: newId("exo"),
					accountId: account.id,
					remoteMessageId: change.remoteMessageId,
					lumimailMessageId: messageId,
					r2Key: originalKey,
					sha256: await sha256Bytes(change.rawMime),
					size: change.rawMime.byteLength,
					retainedAt: now,
				});
			}
			try {
				await db.batch([mappingInsert, ...(originalInsert ? [originalInsert] : [])]);
			} catch (error) {
				if (originalKey) await cleanupAttachmentObjects(env, [originalKey]);
				throw error;
			}
			return { status: "existing", messageId };
		}
	}
	const messageId = newMessageId;
	const mailboxAddress = `${mailbox.localPart}@${mailbox.hostname}`;
	const mailboxHeader = formatEmailAddress(mailboxAddress, mailbox.displayName ?? mailbox.localPart);
	const fromAddr = parsed.fromAddr ?? (change.remoteFolderKey === "sent" ? mailboxHeader : "unknown@invalid.local");
	const toAddr = parsed.toAddr && getEmailAddress(parsed.toAddr).toLowerCase() !== mailboxAddress.toLowerCase()
		? parsed.toAddr
		: mailboxHeader;
	const prepared = prepareInboundAttachments(parsed.attachments);
	const attachmentRows = prepared.attachments.map((attachment) => {
		const id = newId("att");
		return {
			id,
			messageId,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
			r2Key: attachmentKey(mailbox.userId, messageId, id),
			content: attachment.content,
			disposition: attachment.disposition,
			contentId: attachment.contentId,
		};
	});
	const threading = await resolveInboundThreading({
		mailboxId: mailbox.id,
		messageId: parsed.messageId,
		inReplyTo: parsed.inReplyTo,
		references: parsed.references,
		fallbackThreadId: () => newId("thr"),
		findAncestor: async (candidates) => {
			const rows = await db.select({
				rfcMessageId: messages.rfcMessageId,
				providerMessageId: messages.providerMessageId,
				threadId: messages.threadId,
			}).from(messages).where(and(
				eq(messages.mailboxId, mailbox.id),
				or(
					inArray(messages.rfcMessageId, candidates),
					inArray(messages.providerMessageId, candidates),
				),
			));
			for (const candidate of candidates) {
				const match = rows.find((row) =>
					row.rfcMessageId === candidate || row.providerMessageId === candidate);
				if (match) return { threadId: match.threadId };
			}
			return null;
		},
	});
	const sent = change.remoteFolderKey === "sent";
	const messageInsert = db.insert(messages).values({
		id: messageId,
		userId: mailbox.userId,
		organizationId: account.organizationId,
		mailboxId: mailbox.id,
		direction: sent ? "outbound" : "inbound",
		providerMessageId: threading.rfcMessageId,
		rfcMessageId: threading.rfcMessageId,
		inReplyTo: threading.inReplyTo,
		referencesHeader: threading.referencesHeader,
		fromAddr,
		toAddr,
		subject: parsed.subject,
		snippet: buildSnippet(parsed.text, parsed.html),
		status: sent ? "sent" : "received",
		threadId: threading.threadId,
		attachmentStatus: prepared.status,
		attachmentError: prepared.error,
	});
	const bodyInsert = db.insert(messageBodies).values({
		id: newId(),
		messageId,
		textBody: parsed.text,
		htmlBody: parsed.html,
		rawR2Key: null,
	});
	const attachmentInsert = attachmentRows.length
		? db.insert(attachments).values(attachmentRows.map((attachment) => ({
			id: attachment.id,
			messageId: attachment.messageId,
			filename: attachment.filename,
			contentType: attachment.contentType,
			size: attachment.size,
			r2Key: attachment.r2Key,
			disposition: attachment.disposition,
			contentId: attachment.contentId,
		})))
		: null;
	const mappingInsert = db.insert(externalMessages).values({
		id: externalMessageId,
		accountId: account.id,
		remoteMessageId: change.remoteMessageId,
		remoteThreadId: change.remoteThreadId,
		remoteFolderKey: change.remoteFolderKey,
		lumimailMessageId: messageId,
		remoteRevision: change.remoteRevision,
		firstSeenAt: now,
		lastSeenAt: now,
	});

	const attemptedKeys: string[] = [];
	let originalInsert: ReturnType<ReturnType<typeof db.insert>["values"]> | null = null;
	if (account.retainOriginal) {
		const r2Key = `external-originals/${account.organizationId}/${account.id}/${externalMessageId}.eml`;
		attemptedKeys.push(r2Key);
		await env.BUCKET.put(r2Key, change.rawMime, {
			httpMetadata: { contentType: "message/rfc822" },
		});
		originalInsert = db.insert(externalOriginals).values({
			id: newId("exo"),
			accountId: account.id,
			remoteMessageId: change.remoteMessageId,
			lumimailMessageId: messageId,
			r2Key,
			sha256: await sha256Bytes(change.rawMime),
			size: change.rawMime.byteLength,
			retainedAt: now,
		});
	}
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
			mappingInsert,
			...(originalInsert ? [originalInsert] : []),
		]);
	} catch (error) {
		await cleanupAttachmentObjects(env, attemptedKeys);
		throw error;
	}
	return { status: "created", messageId };
}
