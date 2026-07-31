import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { messageBodies, messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, parseJsonBody } from "@/lib/api/response";
import { buildSnippet } from "@/lib/email/parse";
import { selectDraftWithBody } from "./utils";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { normalizeAuthoredContent } from "@/lib/email/authored-content";
import {
	normalizedReplySourceId,
	validateDraftAccess,
	validateReplySourceShape,
} from "@/lib/drafts/validate";

// `replyToMessageId` stays unknown so validateDraftInput can answer the
// historical bare `{ error: "Invalid reply source" }` 400 for bad shapes.
const draftPayloadSchema = z.object({
	mailboxId: z.string().nullish(),
	from: z.string().optional(),
	to: z.string().optional(),
	subject: z.string().optional(),
	text: z.string().optional(),
	html: z.string().optional(),
	replyToMessageId: z.unknown().optional(),
});

export const GET = withUser<{ id: string }>(async ({ env, user, params }) => {
	const db = getDb(env);
	const draft = await selectDraftWithBody(db, user.id, user.organizationId, params.id);

	if (!draft) {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}

	return apiSuccess({ draft });
});

export const PATCH = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const { id } = params;
	const { data: input, errorResponse } = await parseJsonBody(request, draftPayloadSchema);
	if (errorResponse) return errorResponse;
	const invalidShape = validateReplySourceShape(input);
	if (invalidShape) return invalidShape;
	const db = getDb(env);
	const [draft] = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, id), messageAccessCondition(db, user.id, user.organizationId, "send")))
		.limit(1);

	if (!draft || draft.status !== "draft") {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}
	const denied = await validateDraftAccess(db, user, input);
	if (denied) return denied;

	const content = normalizeAuthoredContent(input);
	await db
		.update(messages)
		.set({
			mailboxId: input.mailboxId ?? null,
			organizationId: input.mailboxId ? user.organizationId : null,
			fromAddr: input.from ?? "",
			toAddr: input.to ?? "",
			subject: input.subject ?? null,
			snippet: buildSnippet(content.text, content.html),
			replySourceMessageId: normalizedReplySourceId(input),
		})
		.where(eq(messages.id, id));

	await db
		.update(messageBodies)
		.set({
			textBody: content.text,
			htmlBody: content.html,
		})
		.where(eq(messageBodies.messageId, id));

	return apiSuccess({ draft: { id } });
});

export const DELETE = withUser<{ id: string }>(async ({ env, user, params }) => {
	const { id } = params;
	const db = getDb(env);
	const [draft] = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, id), messageAccessCondition(db, user.id, user.organizationId, "send")))
		.limit(1);

	if (!draft || draft.status !== "draft") {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}

	await db.delete(messages).where(eq(messages.id, id));
	return apiSuccess({ ok: true });
});
