import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/handler";
import { getDb } from "@/db";
import { messages, labels, messageLabels } from "@/db/schema";
import { apiSuccess, apiError } from "@/lib/api/response";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

const labelIdSchema = z.object({ labelId: z.string().min(1) });

export const GET = withUser<{ messageId: string }>(async ({ env, user, params }) => {
	const { messageId } = params;

	const db = getDb(env);
	const msg = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, messageId), messageAccessCondition(db, user.id, user.organizationId, "read")))
		.get();

	if (!msg) return apiError("Message not found", 404);

	const rows = await db
		.select({ label: labels })
		.from(messageLabels)
		.innerJoin(labels, eq(messageLabels.labelId, labels.id))
		.where(eq(messageLabels.messageId, messageId));

	return apiSuccess(rows.map((r) => r.label));
});

export const POST = withUser<{ messageId: string }>(async ({ request, env, user, params }) => {
	const { messageId } = params;

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
		.where(and(eq(messages.id, messageId), messageAccessCondition(db, user.id, user.organizationId, "read")))
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
});

export const DELETE = withUser<{ messageId: string }>(async ({ request, env, user, params }) => {
	const { messageId } = params;

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
		.where(and(eq(messages.id, messageId), messageAccessCondition(db, user.id, user.organizationId, "read")))
		.get();

	if (!msg) return apiError("Message not found", 404);

	await db
		.delete(messageLabels)
		.where(and(eq(messageLabels.messageId, messageId), eq(messageLabels.labelId, labelId)));

	return apiSuccess({ messageId, labelId });
});
