import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/cloudflare";
import { deleteSession, SESSION_COOKIE } from "@/lib/auth/session";

// F40 envelope exception (T-33): /api/auth/logout deliberately keeps its flat
// `{ ok: true }` body. It is part of the bespoke session bootstrap/teardown
// surface in `src/lib/auth/client.ts`. Do not wrap in `apiSuccess`.
export async function POST(request: Request) {
	const env = getEnv();
	const jar = await cookies();
	const authorization = request.headers.get("Authorization");
	const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
	const token = bearerToken || jar.get(SESSION_COOKIE)?.value;
	if (token) await deleteSession(env, token);

	const response = NextResponse.json({ ok: true });
	response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
	return response;
}
