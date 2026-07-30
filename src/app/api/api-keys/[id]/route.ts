import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { apiKeys } from "@/db/schema";
import { withUser } from "@/lib/api/handler";

export const DELETE = withUser<{ id: string }>(async ({ env, user, params }) => {
	const { id } = params;
	const db = getDb(env);
	const [revoked] = await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(
			and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)),
		)
		.returning({ id: apiKeys.id });

	if (!revoked) {
		return NextResponse.json({ error: "API key not found" }, { status: 404 });
	}
	return NextResponse.json({ ok: true });
});
