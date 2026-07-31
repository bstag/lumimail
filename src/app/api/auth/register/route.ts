import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import {
	firstRunRegisterSchema,
	inviteRegisterSchema,
} from "@/lib/validators";
import {
	registerFirstRunUser,
	registerFromInvite,
} from "@/lib/auth/registration";
import { getPrimaryDomain } from "@/lib/user";
import { apiError } from "@/lib/api/response";
import { enforceRateLimit, rateLimitIp } from "@/lib/rate-limit";

// F40 envelope exception (T-33): /api/auth/register deliberately keeps its
// flat success body (`{ redirect }`). The registration client parses it
// bespokely as part of the session bootstrap flow. Do not wrap in `apiSuccess`.
async function authenticatedResponse(env: CloudflareEnv, userId: string) {
	const token = await createSession(env, userId);
	const response = NextResponse.json({ redirect: "/inbox" });
	setSessionCookie(response, token);
	return response;
}

export async function POST(request: Request) {
	const env = getEnv();
	const limited = await enforceRateLimit(rateLimitIp(env, request, "register", 5, 60_000), {
		unavailableLog: "Registration rate limit unavailable",
		limitedMessage: "Too many attempts",
		respond: apiError,
	});
	if (limited) return limited;
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object") return apiError("Invalid registration", 400);

	const record = body as Record<string, unknown>;
	const inviteToken = typeof record.inviteToken === "string" ? record.inviteToken.trim() : "";
	if (inviteToken) {
		const parsed = inviteRegisterSchema.safeParse(record);
		if (!parsed.success) return apiError("Invalid registration", 400);

		const result = await registerFromInvite(env, { ...parsed.data, inviteToken });
		if (!result.ok) {
			switch (result.error) {
				case "email_taken":
					return apiError("Email already registered", 409);
				case "unavailable":
					return apiError("Unable to accept invitation", 503);
				default: // invite_not_found | claim_conflict
					return apiError("Invite not found or expired", 404);
			}
		}
		return authenticatedResponse(env, result.userId);
	}

	const primaryDomain = await getPrimaryDomain(env);
	if (primaryDomain) return apiError("Registration requires an invitation", 403);
	const firstRunParsed = firstRunRegisterSchema.safeParse(record);

	if (!firstRunParsed.success) {
		return NextResponse.json({ error: firstRunParsed.error.flatten() }, { status: 400 });
	}

	const result = await registerFirstRunUser(env, firstRunParsed.data);
	if (!result.ok) {
		return result.error === "email_taken"
			? NextResponse.json({ error: "Email already registered" }, { status: 409 })
			: apiError("Domain setup failed", 502);
	}

	return authenticatedResponse(env, result.userId);
}
