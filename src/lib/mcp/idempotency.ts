import { getEmailAddress } from "@/lib/email/address";
import { sha256Hex } from "@/lib/crypto-utils";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~-]{16,128}$/;

export type McpSendRequest = {
	from: string;
	to: string;
	subject: string;
	text?: string;
	html?: string;
	mailboxId?: string;
	replyToMessageId?: string;
};

type ExistingIdempotency = {
	requestHash: string;
	messageId: string;
	status: "queued" | "sent" | "failed";
};

export class IdempotencyConflictError extends Error {
	constructor() {
		super("Idempotency key was already used for a different request");
		this.name = "IdempotencyConflictError";
	}
}

export function assertIdempotencyKey(value: string): string {
	if (!IDEMPOTENCY_KEY.test(value)) throw new Error("Invalid idempotency key");
	return value;
}

export async function hashMcpSendRequest(input: McpSendRequest): Promise<string> {
	return sha256Hex(JSON.stringify({
		from: getEmailAddress(input.from).trim().toLowerCase(),
		to: getEmailAddress(input.to).trim().toLowerCase(),
		subject: input.subject,
		text: input.text ?? null,
		html: input.html ?? null,
		mailboxId: input.mailboxId ?? null,
		replyToMessageId: input.replyToMessageId ?? null,
	}));
}

export function resolveExistingIdempotency(
	existing: ExistingIdempotency | null,
	requestHash: string,
): { messageId: string; status: ExistingIdempotency["status"]; replayed: true } | null {
	if (!existing) return null;
	if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
	return { messageId: existing.messageId, status: existing.status, replayed: true };
}
