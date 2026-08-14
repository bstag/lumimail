import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, securityAuditEvents } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { sendEmail } from "@/lib/email/outbound/submit";
import { newId } from "@/lib/ids";
import { assertIdempotencyKey, hashMcpSendRequest, type McpSendRequest } from "@/lib/mcp/idempotency";
import { getMcpMessage } from "@/lib/mcp/read";
import { rateLimitUser } from "@/lib/rate-limit";

type MutationActor = { connectionId: string; userId: string; organizationId: string };

function mutationAudit(actor: MutationActor, requestId: string, now: Date) {
	return {
		id: newId("aud"), organizationId: actor.organizationId, actorUserId: actor.userId,
		action: "mcp.mutate" as const, resourceType: "mcp_connection" as const,
		resourceId: actor.connectionId, affectedCount: 1, requestId,
		outcome: "succeeded" as const, createdAt: now,
	};
}

export async function changeMcpMessageState(env: CloudflareEnv, args: MutationActor & {
	messageId: string;
	change: { read?: boolean; starred?: boolean; status?: "received" | "archived" | "trash" | "spam" };
	requestId: string;
	now?: Date;
}) {
	const db = getDb(env);
	const [message] = await db.select({ id: messages.id }).from(messages).where(and(
		eq(messages.id, args.messageId),
		messageAccessCondition(db, args.userId, args.organizationId, "read"),
	)).limit(1);
	if (!message) return { updated: false };
	await db.batch([
		db.update(messages).set(args.change).where(and(
			eq(messages.id, args.messageId),
			messageAccessCondition(db, args.userId, args.organizationId, "read"),
		)),
		db.insert(securityAuditEvents).values(mutationAudit(args, args.requestId, args.now ?? new Date())),
	]);
	return { updated: true };
}

type McpSendArgs = Omit<McpSendRequest, "replyToMessageId"> & {
	connectionId: string;
	userId: string;
	organizationId?: string;
	idempotencyKey: string;
	replyToMessageId?: string;
};

export class McpSendRateLimitError extends Error {
	constructor() {
		super("Send rate limit exceeded");
		this.name = "McpSendRateLimitError";
	}
}

export async function sendMcpMail(env: CloudflareEnv, args: McpSendArgs) {
	const key = assertIdempotencyKey(args.idempotencyKey);
	const limited = await rateLimitUser(env, args.userId, "send", 50, 3_600_000);
	if (!limited.allowed) throw new McpSendRateLimitError();
	const request: McpSendRequest = {
		from: args.from, to: args.to, subject: args.subject,
		...(args.text !== undefined ? { text: args.text } : {}),
		...(args.html !== undefined ? { html: args.html } : {}),
		...(args.mailboxId !== undefined ? { mailboxId: args.mailboxId } : {}),
		...(args.replyToMessageId !== undefined ? { replyToMessageId: args.replyToMessageId } : {}),
	};
	const requestHash = await hashMcpSendRequest(request);
	return sendEmail(env, {
		userId: args.userId,
		...request,
		idempotency: {
			principalType: "mcp",
			principalId: args.connectionId,
			key,
			requestHash,
			...(args.organizationId ? { audit: {
				organizationId: args.organizationId,
				actorUserId: args.userId,
				requestId: newId("req"),
			} } : {}),
		},
	});
}

export async function forwardMcpMail(env: CloudflareEnv, args: MutationActor & {
	sourceMessageId: string;
	from: string;
	to: string;
	subject: string;
	text?: string;
	mailboxId?: string;
	idempotencyKey: string;
}) {
	const source = await getMcpMessage(env, args.userId, args.organizationId, args.sourceMessageId);
	if (!source) throw new Error("Source message not found");
	const original = source.message.textBody ?? source.message.snippet ?? "";
	const forwardText = `${args.text ?? ""}\n\n---------- Forwarded message ----------\nFrom: ${source.message.from}\nSubject: ${source.message.subject ?? ""}\n\n${original}`;
	return sendMcpMail(env, {
		connectionId: args.connectionId,
		userId: args.userId,
		organizationId: args.organizationId,
		from: args.from,
		to: args.to,
		subject: args.subject,
		text: forwardText,
		...(args.mailboxId ? { mailboxId: args.mailboxId } : {}),
		idempotencyKey: args.idempotencyKey,
		replyToMessageId: undefined,
	});
}
