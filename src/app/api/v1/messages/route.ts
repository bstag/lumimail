import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { authenticateApiKey, requireScope } from "@/lib/api/auth";
import { getDb } from "@/db";
import { imapUidCounter, messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";
import { apiError, apiSuccess } from "@/lib/api/response";

const querySchema = z.object({
	mailboxId: z.string().min(1).optional(),
	direction: z.enum(["inbound", "outbound"]).optional(),
	status: z.enum(["received", "queued", "sent", "failed", "draft", "spam", "trash", "archived"]).optional(),
	starred: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
	limit: z.coerce.number().int().min(1).transform((value) => Math.min(value, 100)).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth || !requireScope(auth.scopes, "read")) {
		return apiError("Unauthorized", 401);
	}

	const url = new URL(request.url);
	const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
	if (!parsed.success) return apiError("Invalid query", 400, parsed.error.flatten());
	const { mailboxId, direction, status, starred, limit, offset } = parsed.data;

	const db = getDb(env);
	const conditions = [messageAccessCondition(db, auth.userId, auth.organizationId, "read")];
	if (mailboxId) conditions.push(eq(messages.mailboxId, mailboxId));
	if (direction === "inbound" || direction === "outbound") {
		conditions.push(eq(messages.direction, direction));
	}
	if (status) conditions.push(eq(messages.status, status));
	if (starred !== undefined) conditions.push(eq(messages.starred, starred));

	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(limit + 1)
		.offset(offset);
	const [counter] = await db
		.select({ value: imapUidCounter.value })
		.from(imapUidCounter)
		.where(eq(imapUidCounter.id, 1))
		.limit(1);
	const highestReturnedUid = rows.reduce(
		(highest, message) => Math.max(highest, message.imapUid ?? 0),
		0,
	);

	return apiSuccess({
		messages: rows.slice(0, limit),
		hasMore: rows.length > limit,
		uidNext: (counter?.value ?? highestReturnedUid) + 1,
	});
}
