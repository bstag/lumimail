import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageBodies, messages, securityAuditEvents } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import {
	normalizedReplySourceId,
	validateDraftAccess,
	validateDraftInput,
	validateReplySourceShape,
	type DraftInput,
} from "@/lib/drafts/validate";
import { normalizeAuthoredContent } from "@/lib/email/authored-content";
import { buildSnippet } from "@/lib/email/parse";
import { newId } from "@/lib/ids";

type DraftActor = { connectionId: string; userId: string; organizationId: string };

function audit(actor: DraftActor, requestId: string, now: Date) {
	return {
		id: newId("aud"), organizationId: actor.organizationId, actorUserId: actor.userId,
		action: "mcp.mutate" as const, resourceType: "mcp_connection" as const,
		resourceId: actor.connectionId, affectedCount: 1, requestId,
		outcome: "succeeded" as const, createdAt: now,
	};
}

export async function createMcpDraft(
	env: CloudflareEnv,
	actor: DraftActor,
	input: DraftInput,
	requestId: string,
	now = new Date(),
) {
	const db = getDb(env);
	const user = { id: actor.userId, organizationId: actor.organizationId };
	if (await validateDraftInput(db, user, input)) return null;
	const id = newId("msg");
	const content = normalizeAuthoredContent(input);
	await db.batch([
		db.insert(messages).values({
			id, userId: actor.userId, organizationId: input.mailboxId ? actor.organizationId : null,
			mailboxId: input.mailboxId ?? null, direction: "outbound", fromAddr: input.from ?? "",
			toAddr: input.to ?? "", subject: input.subject ?? null,
			snippet: buildSnippet(content.text, content.html), status: "draft", read: true,
			replySourceMessageId: normalizedReplySourceId(input),
		}),
		db.insert(messageBodies).values({ id: newId(), messageId: id, textBody: content.text, htmlBody: content.html }),
		db.insert(securityAuditEvents).values(audit(actor, requestId, now)),
	]);
	return { id };
}

export async function updateMcpDraft(
	env: CloudflareEnv,
	actor: DraftActor,
	id: string,
	input: DraftInput,
	requestId: string,
	now = new Date(),
) {
	if (validateReplySourceShape(input)) return null;
	const db = getDb(env);
	const [draft] = await db.select({ id: messages.id, status: messages.status }).from(messages).where(and(
		eq(messages.id, id), messageAccessCondition(db, actor.userId, actor.organizationId, "send"),
	)).limit(1);
	if (!draft || draft.status !== "draft") return null;
	if (await validateDraftAccess(db, { id: actor.userId, organizationId: actor.organizationId }, input)) return null;
	const content = normalizeAuthoredContent(input);
	await db.batch([
		db.update(messages).set({
			mailboxId: input.mailboxId ?? null,
			organizationId: input.mailboxId ? actor.organizationId : null,
			fromAddr: input.from ?? "", toAddr: input.to ?? "", subject: input.subject ?? null,
			snippet: buildSnippet(content.text, content.html),
			replySourceMessageId: normalizedReplySourceId(input),
		}).where(eq(messages.id, id)),
		db.update(messageBodies).set({ textBody: content.text, htmlBody: content.html }).where(eq(messageBodies.messageId, id)),
		db.insert(securityAuditEvents).values(audit(actor, requestId, now)),
	]);
	return { id };
}

export async function deleteMcpDraft(
	env: CloudflareEnv,
	actor: DraftActor,
	id: string,
	requestId: string,
	now = new Date(),
) {
	const db = getDb(env);
	const [draft] = await db.select({ id: messages.id, status: messages.status }).from(messages).where(and(
		eq(messages.id, id), messageAccessCondition(db, actor.userId, actor.organizationId, "send"),
	)).limit(1);
	if (!draft || draft.status !== "draft") return null;
	await db.batch([
		db.delete(messages).where(and(
			eq(messages.id, id), messageAccessCondition(db, actor.userId, actor.organizationId, "send"),
		)),
		db.insert(securityAuditEvents).values(audit(actor, requestId, now)),
	]);
	return { deleted: true };
}
