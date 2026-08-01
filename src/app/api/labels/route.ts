import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { labels } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { newId } from "@/lib/ids";
import { apiSuccess, apiError, parseJsonBody } from "@/lib/api/response";
import { createLabelSchema } from "@/lib/validators";
import { getLabelParentError } from "./utils";

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

	const { name, color, parentId } = data;

	const db = getDb(env);

	if (parentId) {
		const parent = await db
			.select({ id: labels.id, parentId: labels.parentId })
			.from(labels)
			.where(and(eq(labels.id, parentId), eq(labels.userId, user.id)))
			.get();

		// A new label has no children of its own yet, so that rule cannot apply.
		const parentError = getLabelParentError({ parentId, parent: parent ?? null, hasChildren: false });
		if (parentError) return apiError(parentError.message, parentError.status);
	}

	const [label] = await db
		.insert(labels)
		.values({
			id: newId("lbl"),
			userId: user.id,
			organizationId: user.organizationId ?? null,
			name,
			color,
			parentId: parentId ?? null,
		})
		.returning();

	return apiSuccess(label, 201);
});
