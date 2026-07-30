import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageFilters } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, apiError } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import { createFilterSchema } from "@/lib/validators";

export const GET = withUser(async ({ env, user }) => {
	const db = getDb(env);
	const rows = await db
		.select()
		.from(messageFilters)
		.where(eq(messageFilters.userId, user.id));

	return apiSuccess({ filters: rows });
});

export const POST = withUser(async ({ request, env, user }) => {
	const parsed = createFilterSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	const id = newId("filter");
	const db = getDb(env);
	await db.insert(messageFilters).values({
		id,
		userId: user.id,
		...parsed.data,
		fromContains: parsed.data.fromContains ?? null,
		toContains: parsed.data.toContains ?? null,
		subjectContains: parsed.data.subjectContains ?? null,
		hasWords: parsed.data.hasWords ?? null,
		actionLabelId: parsed.data.actionLabelId ?? null,
	});

	return apiSuccess({ id });
});
