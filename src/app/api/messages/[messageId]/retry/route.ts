import { and, eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { apiError, apiSuccess } from "@/lib/api/response";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { recoverOutboundJob } from "@/lib/email/send";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ messageId: string }> },
) {
	const { messageId } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	// Send capability, not read: recovery emits mail, so it must be gated exactly
	// as composing from this mailbox is. A caller without it gets 404 rather than
	// 403 so the response cannot confirm the message exists.
	const [message] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(
			eq(messages.id, messageId),
			eq(messages.direction, "outbound"),
			messageAccessCondition(db, user.id, user.organizationId, "send"),
		))
		.limit(1);

	if (!message) return apiError("Message not found", 404);

	const result = await recoverOutboundJob(env, messageId);
	if (result.status === "not_failed") {
		return apiError("Message is not in a failed state", 409);
	}
	if (result.status === "queue_unavailable") {
		return apiError("Queue unavailable", 503);
	}

	return apiSuccess({ messageId, status: "queued" }, 202);
}
