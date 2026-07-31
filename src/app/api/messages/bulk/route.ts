import { and, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiSuccess, parseJsonBody } from "@/lib/api/response";
import {
	getReadValueForBulkAction,
	getStatusForBulkAction,
	isAllowedBulkMessageAction,
} from "./utils";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

// Both fields stay loose (nullable ids, free-form action) so falsy ids are
// still filtered out and an unknown action keeps answering the historical
// bare `{ error: "Invalid bulk message action" }` 400 below.
const bulkMessageSchema = z.object({
	messageIds: z.array(z.string().nullable()).optional(),
	action: z.string().optional(),
});

export const POST = withUser(async ({ request, env, user }) => {
	const { data: payload, errorResponse } = await parseJsonBody(request, bulkMessageSchema);
	if (errorResponse) return errorResponse;
	const messageIds = (payload.messageIds ?? []).filter((id): id is string => Boolean(id));
	if (messageIds.length === 0 || !isAllowedBulkMessageAction(payload.action)) {
		return NextResponse.json({ error: "Invalid bulk message action" }, { status: 400 });
	}

	const status = getStatusForBulkAction(payload.action);
	const read = getReadValueForBulkAction(payload.action);
	const values = {
		...(status ? { status } : {}),
		...(read !== null ? { read } : {}),
	};

	/* v8 ignore next 3 -- every allowed action yields a non-empty values object; guard is defensive */
	if (Object.keys(values).length === 0) {
		return NextResponse.json({ error: "No changes requested" }, { status: 400 });
	}

	const db = getDb(env);
	await db
		.update(messages)
		.set(values)
		.where(and(
			messageAccessCondition(db, user.id, user.organizationId, "read"),
			inArray(messages.id, messageIds),
		));

	return apiSuccess({ ok: true });
});
