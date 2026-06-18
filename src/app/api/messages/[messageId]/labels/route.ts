import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { guardUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { messages, labels, messageLabels } from "@/db/schema";
import { apiSuccess, apiError } from "@/lib/api/response";

const labelIdSchema = z.object({ labelId: z.string().min(1) });

export async function GET(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const { messageId } = await params;

	const db = getDb(env);
	const msg = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, messageId), eq(messages.userId, user.id)))
		.get();

	if (!msg) return apiError("Message not found", 404);

	const rows = await db
		.select({ label: labels })
		.from(messageLabels)
		.innerJoin(labels, eq(messageLabels.labelId, labels.id))
		.where(eq(messageLabels.messageId, messageId));

	return apiSuccess(rows.map((r) => r.label));
}

export async function POST(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const { messageId } = await params;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError("Invalid JSON", 400);
	}

	const parsed = labelIdSchema.safeParse(body);
	/* v8 ignore next -- a Zod failure always carries an issue; the ?? fallback is defensive */
	if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid input", 400);

	const { labelId } = parsed.data;

	const db = getDb(env);
	const msg = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, messageId), eq(messages.userId, user.id)))
		.get();

	if (!msg) return apiError("Message not found", 404);

	const label = await db
		.select()
		.from(labels)
		.where(and(eq(labels.id, labelId), eq(labels.userId, user.id)))
		.get();

	if (!label) return apiError("Label not found", 404);

	await db
		.insert(messageLabels)
		.values({ messageId, labelId })
		.onConflictDoNothing();

	return NextResponse.json({ success: true, data: { messageId, labelId } }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const { messageId } = await params;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError("Invalid JSON", 400);
	}

	const parsed = labelIdSchema.safeParse(body);
	/* v8 ignore next -- a Zod failure always carries an issue; the ?? fallback is defensive */
	if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid input", 400);

	const { labelId } = parsed.data;

	const db = getDb(env);
	const msg = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, messageId), eq(messages.userId, user.id)))
		.get();

	if (!msg) return apiError("Message not found", 404);

	await db
		.delete(messageLabels)
		.where(and(eq(messageLabels.messageId, messageId), eq(messageLabels.labelId, labelId)));

	return apiSuccess({ messageId, labelId });
}
