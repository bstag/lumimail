import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { labels } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, apiError, parseJsonBody } from "@/lib/api/response";
import { updateLabelSchema } from "@/lib/validators";

export const PATCH = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const { id } = params;

	const { data, errorResponse } = await parseJsonBody(request, updateLabelSchema);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const existing = await db
		.select()
		.from(labels)
		.where(and(eq(labels.id, id), eq(labels.userId, user.id)))
		.get();

	if (!existing) return apiError("Label not found", 404);

	const [updated] = await db
		.update(labels)
		.set({ ...data })
		.where(and(eq(labels.id, id), eq(labels.userId, user.id)))
		.returning();

	return apiSuccess(updated);
});

export const DELETE = withUser<{ id: string }>(async ({ env, user, params }) => {
	const { id } = params;

	const db = getDb(env);
	const existing = await db
		.select()
		.from(labels)
		.where(and(eq(labels.id, id), eq(labels.userId, user.id)))
		.get();

	if (!existing) return apiError("Label not found", 404);

	await db.delete(labels).where(and(eq(labels.id, id), eq(labels.userId, user.id)));

	return apiSuccess({ id });
});
