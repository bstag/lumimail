import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { guardUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { labels } from "@/db/schema";
import { apiSuccess, apiError } from "@/lib/api/response";

const updateLabelSchema = z.object({
	name: z.string().min(1).max(50).optional(),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const { id } = await params;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError("Invalid JSON", 400);
	}

	const parsed = updateLabelSchema.safeParse(body);
	/* v8 ignore next -- a Zod failure always carries an issue; the ?? fallback is defensive */
	if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid input", 400);

	const db = getDb(env);
	const existing = await db
		.select()
		.from(labels)
		.where(and(eq(labels.id, id), eq(labels.userId, user.id)))
		.get();

	if (!existing) return apiError("Label not found", 404);

	const [updated] = await db
		.update(labels)
		.set({ ...parsed.data })
		.where(and(eq(labels.id, id), eq(labels.userId, user.id)))
		.returning();

	return apiSuccess(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const { id } = await params;

	const db = getDb(env);
	const existing = await db
		.select()
		.from(labels)
		.where(and(eq(labels.id, id), eq(labels.userId, user.id)))
		.get();

	if (!existing) return apiError("Label not found", 404);

	await db.delete(labels).where(and(eq(labels.id, id), eq(labels.userId, user.id)));

	return apiSuccess({ id });
}
