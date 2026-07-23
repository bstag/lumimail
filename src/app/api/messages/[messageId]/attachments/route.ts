import { eq, and } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { attachments, messages } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { apiSuccess, apiError } from "@/lib/api/response";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ messageId: string }> },
) {
	const { messageId } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const [msg] = await db
		.select({ id: messages.id })
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
		})
		.from(attachments)
		.where(eq(attachments.messageId, messageId));

	return apiSuccess({ attachments: rows });
}
