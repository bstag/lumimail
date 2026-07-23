import { eq, and } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { attachments, messages } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { apiSuccess, apiError } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export async function POST(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const formData = await request.formData();
	const file = formData.get("file") as File | null;
	const messageId = formData.get("messageId") as string | null;

	if (!file || !messageId) return apiError("file and messageId required", 400);
	if (file.size > 25 * 1024 * 1024) return apiError("File too large (max 25MB)", 400);

	const db = getDb(env);
	const [msg] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(eq(messages.id, messageId), messageAccessCondition(db, user.id, user.organizationId, "send")))
		.limit(1);

	if (!msg) return apiError("Message not found", 404);

	const id = newId("att");
	const r2Key = `attachments/${user.id}/${messageId}/${id}/${file.name}`;

	const buffer = await file.arrayBuffer();
	await env.BUCKET.put(r2Key, buffer, {
		httpMetadata: { contentType: file.type || "application/octet-stream" },
	});

	await db.insert(attachments).values({
		id,
		messageId,
		filename: file.name,
		contentType: file.type || "application/octet-stream",
		size: file.size,
		r2Key,
	});

	return apiSuccess({ id, filename: file.name, size: file.size, contentType: file.type });
}
