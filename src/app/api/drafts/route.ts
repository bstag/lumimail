import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { messageBodies, messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, parseJsonBody } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import { buildSnippet } from "@/lib/email/parse";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { normalizeAuthoredContent } from "@/lib/email/authored-content";
import { validateDraftInput, normalizedReplySourceId } from "@/lib/drafts/validate";

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

export const GET = withUser(async ({ request, env, user }) => {
	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const db = getDb(env);
	const conditions = [
		messageAccessCondition(db, user.id, user.organizationId, "send"),
		eq(messages.direction, "outbound" as const),
		eq(messages.status, "draft"),
	];
	if (mailboxId) conditions.push(eq(messages.mailboxId, mailboxId));

	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(100);

	return apiSuccess({ drafts: rows });
});

export const POST = withUser(async ({ request, env, user }) => {
	const { data: input, errorResponse } = await parseJsonBody(request, draftPayloadSchema);
	if (errorResponse) return errorResponse;
	const db = getDb(env);
	const invalid = await validateDraftInput(db, user, input);
	if (invalid) return invalid;

	const draftId = newId("msg");
	const content = normalizeAuthoredContent(input);

	await db.insert(messages).values({
		id: draftId,
		userId: user.id,
		organizationId: input.mailboxId ? user.organizationId : null,
		mailboxId: input.mailboxId ?? null,
		direction: "outbound",
		fromAddr: input.from ?? "",
		toAddr: input.to ?? "",
		subject: input.subject ?? null,
		snippet: buildSnippet(content.text, content.html),
		status: "draft",
		read: true,
		replySourceMessageId: normalizedReplySourceId(input),
	});

	await db.insert(messageBodies).values({
		id: newId(),
		messageId: draftId,
		textBody: content.text,
		htmlBody: content.html,
	});

	return apiSuccess({ draft: { id: draftId } });
});
