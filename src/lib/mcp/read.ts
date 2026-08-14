import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "@/db";
import { attachments, messageBodies, messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

const MAX_ATTACHMENT_BYTES = 1024 * 1024;

type ConversationInput = { limit: number; offset: number; query?: string };

function publicMessage(row: {
	id: string; mailboxId: string | null; threadId: string | null; direction: string;
	fromAddr: string; toAddr: string; subject: string | null; snippet?: string | null;
	status: string; read: boolean; starred: boolean; createdAt: Date;
}) {
	return {
		id: row.id,
		mailboxId: row.mailboxId,
		threadId: row.threadId,
		direction: row.direction,
		from: row.fromAddr,
		to: row.toAddr,
		subject: row.subject,
		...(row.snippet !== undefined ? { snippet: row.snippet } : {}),
		status: row.status,
		read: row.read,
		starred: row.starred,
		createdAt: row.createdAt.toISOString(),
	};
}

export async function listMcpConversations(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	input: ConversationInput,
) {
	const limit = Math.min(Math.max(input.limit, 1), 50);
	const offset = Math.min(Math.max(input.offset, 0), 500);
	const db = getDb(env);
	const conditions = [messageAccessCondition(db, userId, organizationId, "read")];
	const query = input.query?.trim();
	if (query) {
		const pattern = `%${query.slice(0, 200)}%`;
		conditions.push(or(
			like(messages.fromAddr, pattern),
			like(messages.toAddr, pattern),
			like(messages.subject, pattern),
			like(messages.snippet, pattern),
		)!);
	}
	const scanLimit = Math.min((limit + offset) * 4 + 1, 2201);
	const rows = await db
		.select({
			id: messages.id, mailboxId: messages.mailboxId, threadId: messages.threadId,
			direction: messages.direction, fromAddr: messages.fromAddr, toAddr: messages.toAddr,
			subject: messages.subject, snippet: messages.snippet, status: messages.status,
			read: messages.read, starred: messages.starred, createdAt: messages.createdAt,
		})
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(scanLimit);

	const seen = new Set<string>();
	const conversations = rows.flatMap((row) => {
		const conversationId = row.threadId ?? `message:${row.id}`;
		if (seen.has(conversationId)) return [];
		seen.add(conversationId);
		return [{ conversationId, latestMessageId: row.id, ...publicMessage(row) }];
	});
	return {
		conversations: conversations.slice(offset, offset + limit),
		hasMore: conversations.length > offset + limit || rows.length === scanLimit,
		limit,
		offset,
	};
}

export async function getMcpMessage(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	messageId: string,
) {
	const db = getDb(env);
	const [row] = await db
		.select({
			id: messages.id, mailboxId: messages.mailboxId, threadId: messages.threadId,
			direction: messages.direction, fromAddr: messages.fromAddr, toAddr: messages.toAddr,
			subject: messages.subject, snippet: messages.snippet, status: messages.status,
			read: messages.read, starred: messages.starred, createdAt: messages.createdAt,
			textBody: messageBodies.textBody, htmlBody: messageBodies.htmlBody,
		})
		.from(messages)
		.leftJoin(messageBodies, eq(messageBodies.messageId, messages.id))
		.where(and(eq(messages.id, messageId), messageAccessCondition(db, userId, organizationId, "read")))
		.limit(1);
	if (!row) return null;
	const attachmentRows = await db
		.select({
			id: attachments.id, filename: attachments.filename, contentType: attachments.contentType,
			size: attachments.size, disposition: attachments.disposition,
		})
		.from(attachments)
		.where(eq(attachments.messageId, messageId));
	return {
		message: { ...publicMessage(row), textBody: row.textBody, htmlBody: row.htmlBody },
		attachments: attachmentRows,
	};
}

export async function getMcpThread(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	threadId: string,
	requestedLimit: number,
) {
	const db = getDb(env);
	const limit = Math.min(Math.max(requestedLimit, 1), 50);
	const rows = await db
		.select({
			id: messages.id, mailboxId: messages.mailboxId, threadId: messages.threadId,
			direction: messages.direction, fromAddr: messages.fromAddr, toAddr: messages.toAddr,
			subject: messages.subject, status: messages.status, read: messages.read,
			starred: messages.starred, createdAt: messages.createdAt,
			textBody: messageBodies.textBody, htmlBody: messageBodies.htmlBody,
		})
		.from(messages)
		.leftJoin(messageBodies, eq(messageBodies.messageId, messages.id))
		.where(and(eq(messages.threadId, threadId), messageAccessCondition(db, userId, organizationId, "read")))
		.orderBy(asc(messages.createdAt))
		.limit(limit + 1);
	return {
		messages: rows.slice(0, limit).map((row) => ({ ...publicMessage(row), textBody: row.textBody, htmlBody: row.htmlBody })),
		hasMore: rows.length > limit,
	};
}

export async function listMcpDrafts(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	requestedLimit: number,
) {
	const db = getDb(env);
	const limit = Math.min(Math.max(requestedLimit, 1), 50);
	const rows = await db.select({
		id: messages.id, mailboxId: messages.mailboxId, threadId: messages.threadId,
		direction: messages.direction, fromAddr: messages.fromAddr, toAddr: messages.toAddr,
		subject: messages.subject, snippet: messages.snippet, status: messages.status,
		read: messages.read, starred: messages.starred, createdAt: messages.createdAt,
	}).from(messages).where(and(
		eq(messages.status, "draft"),
		messageAccessCondition(db, userId, organizationId, "send"),
	)).orderBy(desc(messages.createdAt)).limit(limit + 1);
	return { drafts: rows.slice(0, limit).map(publicMessage), hasMore: rows.length > limit };
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

export async function getMcpAttachment(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	attachmentId: string,
	requestedMaxBytes: number,
) {
	const maxBytes = Math.min(Math.max(requestedMaxBytes, 1), MAX_ATTACHMENT_BYTES);
	const db = getDb(env);
	const [attachment] = await db
		.select({
			id: attachments.id, filename: attachments.filename, contentType: attachments.contentType,
			size: attachments.size, r2Key: attachments.r2Key,
		})
		.from(attachments)
		.innerJoin(messages, eq(messages.id, attachments.messageId))
		.where(and(eq(attachments.id, attachmentId), messageAccessCondition(db, userId, organizationId, "read")))
		.limit(1);
	if (!attachment) return null;
	if (attachment.size > maxBytes) throw new Error("Attachment exceeds size limit");
	const object = await env.BUCKET.get(attachment.r2Key);
	if (!object) return null;
	if (object.size > maxBytes) throw new Error("Attachment exceeds size limit");
	const bytes = new Uint8Array(await object.arrayBuffer());
	if (bytes.byteLength > maxBytes) throw new Error("Attachment exceeds size limit");
	return {
		id: attachment.id,
		filename: attachment.filename,
		contentType: attachment.contentType,
		size: bytes.byteLength,
		encoding: "base64" as const,
		data: bytesToBase64(bytes),
	};
}
