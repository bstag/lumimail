import { eq, and } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { attachments, messages } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { apiSuccess, apiError } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import {
	AttachmentValidationError,
	MAX_ATTACHMENT_BYTES,
	validateOutboundAttachments,
} from "@/lib/email/outbound-attachments";

export async function POST(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const formData = await request.formData();
	const file = formData.get("file") as File | null;
	const messageId = formData.get("messageId") as string | null;

	if (!file || !messageId) return apiError("file and messageId required", 400);
	const db = getDb(env);
	const [msg] = await db
		.select({ id: messages.id, status: messages.status })
		.from(messages)
		.where(and(eq(messages.id, messageId), messageAccessCondition(db, user.id, user.organizationId, "send")))
		.limit(1);

	if (!msg) return apiError("Message not found", 404);
	if (msg.status !== "draft") return apiError("Attachments can only be added to drafts", 409);
	if (file.size > MAX_ATTACHMENT_BYTES) return apiError("Attachment too large (max 3 MiB)", 400);

	const id = newId("att");
	const buffer = await file.arrayBuffer();
	let normalized;
	try {
		[normalized] = validateOutboundAttachments({
			subject: "",
			attachments: [{
				filename: file.name,
				contentType: file.type,
				content: buffer,
			}],
		});
	} catch (error) {
		return apiError((error as AttachmentValidationError).message, 400);
	}
	const r2Key = `attachments/${user.id}/${messageId}/${id}`;
	await env.BUCKET.put(r2Key, normalized.content, {
		httpMetadata: { contentType: normalized.contentType },
	});

	try {
		await db.insert(attachments).values({
			id,
			messageId,
			filename: normalized.filename,
			contentType: normalized.contentType,
			size: normalized.size,
			r2Key,
		});
	} catch (error) {
		await env.BUCKET.delete(r2Key);
		throw error;
	}

	return apiSuccess({
		id,
		filename: normalized.filename,
		size: normalized.size,
		contentType: normalized.contentType,
	});
}
