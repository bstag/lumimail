import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { apiKeys } from "@/db/schema";
import { guardUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const { id } = await params;
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
}
