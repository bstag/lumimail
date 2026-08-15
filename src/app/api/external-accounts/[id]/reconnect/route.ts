import { cookies } from "next/headers";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { beginExternalAccountReconnect } from "@/lib/email/external/account-management";
import { normalizePublicAppOrigin } from "@/lib/email/external/oauth-provider";
import { isSameOriginMutation } from "@/lib/mcp/authorization-request";
import { enforceRateLimit, rateLimitUser } from "@/lib/rate-limit";

export const POST = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	if (!user.organizationId) return apiError("No active organization", 403);
	let origin: string;
	try {
		origin = normalizePublicAppOrigin(env.PUBLIC_APP_URL);
	} catch {
		return apiError("External accounts are unavailable", 503);
	}
	if (!isSameOriginMutation(request, origin)) return apiError("Forbidden", 403);
	const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
	const session = await readRecentlyAuthenticatedSession(env, user.id, sessionToken);
	if (!session || session.organizationId !== user.organizationId) {
		return apiError("Recent authentication required", 403);
	}
	const limited = await enforceRateLimit(
		rateLimitUser(env, user.id, "external-account-reconnect", 10, 60 * 60 * 1000),
		{
			unavailableLog: "External account reconnect rate limit unavailable",
			limitedMessage: "Too many external account reconnect requests",
			respond: (message, status) => apiError(message, status),
		},
	);
	if (limited) return limited;
	const result = await beginExternalAccountReconnect(env, {
		userId: user.id,
		organizationId: user.organizationId,
		sessionId: session.id,
		accountId: params.id,
	});
	if (result.status === "not-found") return apiError("External account not found", 404);
	if (result.status === "conflict") return apiError("External account state conflict", 409);
	return apiSuccess({ redirectTo: result.redirectTo }, 201);
});
