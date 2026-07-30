import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { labels } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { newId } from "@/lib/ids";
import { apiSuccess, parseJsonBody } from "@/lib/api/response";
import { createLabelSchema } from "@/lib/validators";

export const GET = withUser(async ({ env, user }) => {
	const db = getDb(env);
	const rows = await db
		.select()
		.from(labels)
		.where(eq(labels.userId, user.id))
		.orderBy(labels.createdAt);

	return apiSuccess(rows);
});

export const POST = withUser(async ({ request, env, user }) => {
	const { data, errorResponse } = await parseJsonBody(request, createLabelSchema);
	if (errorResponse) return errorResponse;

	const { name, color } = data;

	const db = getDb(env);
	const [label] = await db
		.insert(labels)
		.values({
			id: newId("lbl"),
			userId: user.id,
			organizationId: user.organizationId ?? null,
			name,
			color,
		})
		.returning();

	return apiSuccess(label, 201);
});
