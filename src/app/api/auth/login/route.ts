import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validators";
import { userHasMailboxes } from "@/lib/user";
import { rateLimitIp, RateLimitUnavailableError } from "@/lib/rate-limit";

export async function POST(request: Request) {
	const env = getEnv();

	let rl;
	try {
		rl = await rateLimitIp(env, request, "login", 5, 60_000);
	} catch (error) {
		if (error instanceof RateLimitUnavailableError) {
			console.error("Login rate limit unavailable");
			return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
		}
		throw error;
	}
	if (!rl.allowed) {
		return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
	}

	const body = await request.json() as Record<string, unknown>;
	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	}

	const db = getDb(env);
	const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
	if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
		return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
	}

	const hasMailboxes = await userHasMailboxes(env, user.id);
	const token = await createSession(env, user.id);
	const response = NextResponse.json({
		ok: true,
		redirect: hasMailboxes ? "/inbox" : "/onboarding",
	});
	response.cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 30,
	});
	return response;
}
