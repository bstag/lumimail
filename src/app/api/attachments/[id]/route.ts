import { eq, and } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { attachments, messages } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { apiError } from "@/lib/api/response";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const [att] = await db
		.select({
			id: attachments.id,
			filename: attachments.filename,
			contentType: attachments.contentType,
			size: attachments.size,
			r2Key: attachments.r2Key,
			messageUserId: messages.userId,
		})
		.from(attachments)
		.innerJoin(messages, eq(attachments.messageId, messages.id))
		.where(and(eq(attachments.id, id), messageAccessCondition(db, user.id, user.organizationId, "read")))
		.limit(1);

	if (!att) return apiError("Attachment not found", 404);

	const obj = await env.BUCKET.get(att.r2Key);
	if (!obj) return apiError("File not found", 404);

	const url = new URL(request.url);
	const inline = url.searchParams.get("disposition") === "inline";

	const headers = new Headers();
	headers.set("Content-Type", att.contentType);
	headers.set(
		"Content-Disposition",
		`${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(att.filename)}"`,
	);
	headers.set("Content-Length", att.size.toString());
	headers.set("Cache-Control", "private, max-age=3600");

	return new Response(obj.body, { headers });
}
