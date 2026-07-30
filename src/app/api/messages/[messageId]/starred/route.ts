import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/response";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

const starredSchema = z.object({ starred: z.boolean() });

export const PATCH = withUser<{ messageId: string }>(async ({ request, env, user, params }) => {
	const { messageId } = params;
	const { data, errorResponse } = await parseJsonBody(request, starredSchema);
	if (errorResponse) return errorResponse;
	const { starred } = data;

	const db = getDb(env);
	const [updated] = await db
		.update(messages)
		.set({ starred })
		.where(and(eq(messages.id, messageId), messageAccessCondition(db, user.id, user.organizationId, "read")))
		.returning({ starred: messages.starred });

	if (!updated) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	return NextResponse.json({ starred: updated.starred });
});
