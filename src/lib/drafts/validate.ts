import { NextResponse } from "next/server";
import type { getDb } from "@/db";
import { getMailboxAccess, hasMailboxCapability } from "@/lib/auth/mailbox-access";
import { selectAccessibleReplySource } from "@/lib/email/reply-source";

export type DraftInput = {
	mailboxId?: string | null;
	from?: string;
	to?: string;
	subject?: string;
	text?: string;
	html?: string;
	replyToMessageId?: unknown;
};

type Db = ReturnType<typeof getDb>;

type DraftUser = { id: string; organizationId: string | null };

/**
 * Shape check for `replyToMessageId`: when present it must be a non-empty
 * string of at most 100 characters. Returns the historical bare
 * `{ error: "Invalid reply source" }` 400, or `null` when acceptable.
 * PATCH runs this before its draft lookup, so it stands alone.
 */
export function validateReplySourceShape(input: DraftInput): NextResponse | null {
	const replyToMessageId = input.replyToMessageId;
	if (
		replyToMessageId !== undefined
		&& (
			typeof replyToMessageId !== "string"
			|| replyToMessageId.trim().length === 0
			|| replyToMessageId.length > 100
		)
	) {
		return NextResponse.json({ error: "Invalid reply source" }, { status: 400 });
	}
	return null;
}

/**
 * Access checks shared by draft create (POST /api/drafts) and update
 * (PATCH /api/drafts/[id]): the target mailbox must grant the send capability
 * and a reply source must be reachable from that mailbox. Denials answer 404
 * so responses cannot confirm that a mailbox or message exists. Call after
 * `validateReplySourceShape` accepted the input.
 */
export async function validateDraftAccess(
	db: Db,
	user: DraftUser,
	input: DraftInput,
): Promise<NextResponse | null> {
	if (input.mailboxId) {
		const access = user.organizationId
			? await getMailboxAccess(db, user.id, user.organizationId, input.mailboxId)
			: null;
		if (!access || !hasMailboxCapability(access.role, "send")) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
	}
	// A defined replyToMessageId that passed the shape check is a non-empty
	// string, so this test is equivalent to the historical truthiness test.
	if (typeof input.replyToMessageId === "string") {
		if (
			!input.mailboxId
			|| !await selectAccessibleReplySource(
				db,
				user.id,
				user.organizationId,
				input.mailboxId,
				input.replyToMessageId.trim(),
			)
		) {
			return NextResponse.json({ error: "Reply source not found" }, { status: 404 });
		}
	}
	return null;
}

/** Full validation (shape then access) in one call, as POST /api/drafts runs it. */
export async function validateDraftInput(
	db: Db,
	user: DraftUser,
	input: DraftInput,
): Promise<NextResponse | null> {
	return validateReplySourceShape(input) ?? await validateDraftAccess(db, user, input);
}

/**
 * Normalized reply-source id for persistence: the validated trimmed string, or
 * `null` when the draft is not a reply. Call only after validation accepted
 * the input.
 */
export function normalizedReplySourceId(input: DraftInput): string | null {
	return typeof input.replyToMessageId === "string" ? input.replyToMessageId.trim() : null;
}
