import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { attachments, messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, apiError } from "@/lib/api/response";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export const GET = withUser<{ messageId: string }>(async ({ env, user, params }) => {
	const { messageId } = params;
	const db = getDb(env);
	const [msg] = await db
		.select({
			id: messages.id,
			attachmentStatus: messages.attachmentStatus,
			attachmentError: messages.attachmentError,
		})
		.from(messages)
		.where(and(eq(messages.id, messageId), messageAccessCondition(db, user.id, user.organizationId, "read")))
		.limit(1);

	if (!msg) return apiError("Message not found", 404);

	const rows = await db
		.select({
			id: attachments.id,
			filename: attachments.filename,
			contentType: attachments.contentType,
			size: attachments.size,
			disposition: attachments.disposition,
			contentId: attachments.contentId,
		})
		.from(attachments)
		.where(eq(attachments.messageId, messageId));

	return apiSuccess({
		attachmentStatus: msg.attachmentStatus,
		attachmentError: msg.attachmentError,
		attachments: rows,
	});
});
