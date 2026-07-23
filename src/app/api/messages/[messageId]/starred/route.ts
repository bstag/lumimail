import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { guardUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { messageAccessCondition } from "@/lib/auth/mailbox-access";

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ messageId: string }> },
) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const { messageId } = await params;
	const body = await request.json() as { starred: boolean };
	const { starred } = body;

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
}
