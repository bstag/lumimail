import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { webhooks } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, apiError, parseJsonBody } from "@/lib/api/response";

const updateWebhookSchema = z.object({
	enabled: z.boolean().optional(),
});

export const DELETE = withUser<{ id: string }>(async ({ env, user, params }) => {
	const { id } = params;
	const db = getDb(env);
	const [webhook] = await db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.id, id), eq(webhooks.userId, user.id)))
		.limit(1);

	if (!webhook) return apiError("Webhook not found", 404);

	await db.delete(webhooks).where(eq(webhooks.id, id));
	return apiSuccess({ ok: true });
});

export const PATCH = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const { id } = params;
	const db = getDb(env);
	const [webhook] = await db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.id, id), eq(webhooks.userId, user.id)))
		.limit(1);

	if (!webhook) return apiError("Webhook not found", 404);

	const { data, errorResponse } = await parseJsonBody(request, updateWebhookSchema);
	if (errorResponse) return errorResponse;
	if (typeof data.enabled === "boolean") {
		await db.update(webhooks).set({ enabled: data.enabled }).where(eq(webhooks.id, id));
	}

	return apiSuccess({ ok: true });
});
