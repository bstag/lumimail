import { cookies } from "next/headers";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { getBearerToken } from "@/lib/auth/cookies";
import { reconfirmSession } from "@/lib/auth/recent-auth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { enforceRateLimit, rateLimitUser } from "@/lib/rate-limit";
import { reconfirmPasswordSchema } from "@/lib/validators";

export const POST = withUser(async ({ request, env, user }) => {
	const parsed = await parseJsonBody(request, reconfirmPasswordSchema);
	if (parsed.errorResponse) return parsed.errorResponse;

	const limited = await enforceRateLimit(
		rateLimitUser(env, user.id, "password-reconfirmation", 5, 15 * 60 * 1000),
		{
			unavailableLog: "Password reconfirmation rate limit unavailable",
			limitedMessage: "Too many attempts",
			respond: (message, status) => apiError(message, status),
		},
	);
	if (limited) return limited;

	const bearerToken = getBearerToken(request);
	const cookieToken = bearerToken ? undefined : (await cookies()).get(SESSION_COOKIE)?.value;
	const result = await reconfirmSession(
		env,
		user.id,
		bearerToken ?? cookieToken,
		parsed.data.password,
	);
	if (!result.confirmed) return apiError("Password confirmation failed", 403);

	return apiSuccess({ recentUntil: result.recentUntil.toISOString() });
});
