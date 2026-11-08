import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { snoozeMessageSchema } from "@/lib/validators";

const MAX_SNOOZE_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Snoozes a received message (F100): it leaves the Inbox until `until`, then returns unread and
 * sorted by that time. `until: null` wakes it now.
 */
export const POST = withUser<{ messageId: string }>(async ({ request, env, user, params }) => {
	const parsed = snoozeMessageSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return apiError("Invalid snooze time", 400);
	const now = Date.now();
	const until = parsed.data.until === null ? null : new Date(parsed.data.until);
	if (until && (until.getTime() <= now || until.getTime() > now + MAX_SNOOZE_MS)) {
		return apiError("Snooze time must be within the next year", 400);
	}

	const db = getDb(env);
	const updated = await db.update(messages)
		.set(until ? { snoozedUntil: until, read: false } : { snoozedUntil: null })
		.where(and(
			eq(messages.id, params.messageId),
			eq(messages.direction, "inbound"),
			eq(messages.status, "received"),
			messageAccessCondition(db, user.id, user.organizationId, "read"),
		))
		.returning({ id: messages.id });
	if (updated.length === 0) return apiError("Message not found", 404);
	return apiSuccess({ snoozedUntil: until?.toISOString() ?? null });
});
