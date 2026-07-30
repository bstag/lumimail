import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validators";
import { userHasMailboxes } from "@/lib/user";
import { enforceRateLimit, rateLimitIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
	const env = getEnv();

	const limited = await enforceRateLimit(rateLimitIp(env, request, "login", 5, 60_000), {
		unavailableLog: "Login rate limit unavailable",
		limitedMessage: "Too many attempts",
		// This route predates the `{ success, error }` envelope; its clients read
		// a bare `{ error }` string, so the historical shape is preserved.
		respond: (message, status) => NextResponse.json({ error: message }, { status }),
	});
	if (limited) return limited;

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
	setSessionCookie(response, token);
	return response;
}
