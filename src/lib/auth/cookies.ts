import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getUserFromSession } from "@/lib/auth/session";
import type { User } from "@/db/schema";

function getBearerToken(request?: Request): string | undefined {
	const authorization = request?.headers.get("Authorization");
	if (!authorization?.startsWith("Bearer ")) return undefined;
	const token = authorization.slice(7).trim();
	return token || undefined;
}

export async function getCurrentUser(env: CloudflareEnv, request?: Request) {
	const bearerToken = getBearerToken(request);
	if (bearerToken) return getUserFromSession(env, bearerToken);

	const jar = await cookies();
	const token = jar.get(SESSION_COOKIE)?.value;
	return getUserFromSession(env, token);
}

type GuardResult = { user: User; errorResponse: null } | { user: null; errorResponse: NextResponse };
export async function guardUser(env: CloudflareEnv, request?: Request): Promise<GuardResult> {
	const user = await getCurrentUser(env, request);
	if (!user) return { user: null, errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
	return { user, errorResponse: null };
}
