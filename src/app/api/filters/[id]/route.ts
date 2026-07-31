import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { messageFilters } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, apiError, parseJsonBody } from "@/lib/api/response";

const updateFilterSchema = z.object({
	enabled: z.boolean().optional(),
});

export const DELETE = withUser<{ id: string }>(async ({ env, user, params }) => {
	const { id } = params;
	const db = getDb(env);
	const [filter] = await db
		.select()
		.from(messageFilters)
		.where(and(eq(messageFilters.id, id), eq(messageFilters.userId, user.id)))
		.limit(1);

	if (!filter) return apiError("Filter not found", 404);

	await db.delete(messageFilters).where(eq(messageFilters.id, id));
	return apiSuccess({ ok: true });
});

export const PATCH = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const { id } = params;
	const db = getDb(env);
	const [filter] = await db
		.select()
		.from(messageFilters)
		.where(and(eq(messageFilters.id, id), eq(messageFilters.userId, user.id)))
		.limit(1);

	if (!filter) return apiError("Filter not found", 404);

	const { data, errorResponse } = await parseJsonBody(request, updateFilterSchema);
	if (errorResponse) return errorResponse;
	if (typeof data.enabled === "boolean") {
		await db.update(messageFilters).set({ enabled: data.enabled }).where(eq(messageFilters.id, id));
	}

	return apiSuccess({ ok: true });
});
