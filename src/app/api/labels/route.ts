import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { guardUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { labels } from "@/db/schema";
import { newId } from "@/lib/ids";
import { apiSuccess, apiError } from "@/lib/api/response";

const createLabelSchema = z.object({
	name: z.string().min(1).max(50),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function GET(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const rows = await db
		.select()
		.from(labels)
		.where(eq(labels.userId, user.id))
		.orderBy(labels.createdAt);

	return apiSuccess(rows);
}

export async function POST(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError("Invalid JSON", 400);
	}

	const parsed = createLabelSchema.safeParse(body);
	/* v8 ignore next -- a Zod failure always carries an issue; the ?? fallback is defensive */
	if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid input", 400);

	const { name, color } = parsed.data;

	const db = getDb(env);
	const [label] = await db
		.insert(labels)
		.values({
			id: newId("lbl"),
			userId: user.id,
			organizationId: user.organizationId ?? null,
			name,
			color: color ?? "#6366f1",
		})
		.returning();

	return NextResponse.json({ success: true, data: label }, { status: 201 });
}
