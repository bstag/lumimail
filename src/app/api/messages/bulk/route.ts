import { and, count, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import {
	getReadValueForBulkAction,
	getStatusForBulkAction,
	isAllowedBulkMessageAction,
} from "./utils";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { messageListConditions } from "@/lib/messages/list-conditions";

// Both fields stay loose (nullable ids, free-form action) so falsy ids are
// still filtered out and an unknown action keeps answering the historical
// bare `{ error: "Invalid bulk message action" }` 400 below.
const bulkMessageSchema = z.object({
	messageIds: z.array(z.string().nullable()).optional(),
	action: z.string().optional(),
	/** List-view parameters: act on every message the view shows, not just loaded rows (F102). */
	query: z.record(z.string(), z.string()).optional(),
	preview: z.boolean().optional(),
});

const invalidAction = () => NextResponse.json({ error: "Invalid bulk message action" }, { status: 400 });

export const POST = withUser(async ({ request, env, user }) => {
	const { data: payload, errorResponse } = await parseJsonBody(request, bulkMessageSchema);
	if (errorResponse) return errorResponse;
	if (!isAllowedBulkMessageAction(payload.action)) return invalidAction();
	const messageIds = (payload.messageIds ?? []).filter((id): id is string => Boolean(id));
	if (!payload.query && messageIds.length === 0) return invalidAction();

	const status = getStatusForBulkAction(payload.action);
	const read = getReadValueForBulkAction(payload.action);
	const values = {
		...(status ? { status } : {}),
		...(read !== null ? { read } : {}),
	};

	const db = getDb(env);
	if (payload.query) {
		const conditions = messageListConditions(db, user, new URLSearchParams(payload.query));
		if (conditions.error) return apiError("Invalid query", 400);
		const [row] = await db.select({ matched: count() }).from(messages).where(conditions.where);
		/* v8 ignore next -- count(*) always yields one row; the fallback is defensive */
		const matched = row?.matched ?? 0;
		if (payload.preview) return apiSuccess({ matched });
		if (matched > 0) await db.update(messages).set(values).where(conditions.where);
		return apiSuccess({ ok: true, updated: matched });
	}

	await db
		.update(messages)
		.set(values)
		.where(and(
			messageAccessCondition(db, user.id, user.organizationId, "read"),
			inArray(messages.id, messageIds),
		));

	return apiSuccess({ ok: true });
});
