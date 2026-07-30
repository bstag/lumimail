import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { organizations } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiSuccess, apiError, parseJsonBody } from "@/lib/api/response";

const updateOrganizationSchema = z.object({
	name: z.string().trim().min(1, "Name is required"),
});

export const GET = withOrgAdmin(async ({ env, user }) => {
	const db = getDb(env);
	const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
	if (!org) return apiError("Organization not found", 404);

	return apiSuccess({ organization: org });
});

export const PATCH = withOrgAdmin(async ({ request, env, user }) => {
	const { data, errorResponse } = await parseJsonBody(request, updateOrganizationSchema);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	await db.update(organizations).set({ name: data.name, updatedAt: new Date() }).where(eq(organizations.id, user.organizationId));
	const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);

	return apiSuccess({ organization: org });
});
