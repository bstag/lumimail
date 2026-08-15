import { cookies } from "next/headers";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { beginExternalOAuth } from "@/lib/email/external/connections";
import { normalizePublicAppOrigin } from "@/lib/email/external/oauth-provider";
import { isSameOriginMutation } from "@/lib/mcp/authorization-request";
import { enforceRateLimit, rateLimitUser } from "@/lib/rate-limit";
import { externalAccountConnectSchema } from "@/lib/validators";

export const POST = withUser(async ({ request, env, user }) => {
	let appOrigin: string;
	try {
		appOrigin = normalizePublicAppOrigin(env.PUBLIC_APP_URL);
	} catch {
		return apiError("External OAuth is unavailable", 503);
	}
	if (!isSameOriginMutation(request, appOrigin)) return apiError("Forbidden", 403);
	if (!user.organizationId) return apiError("No active organization", 403);
	const parsed = await parseJsonBody(request, externalAccountConnectSchema);
	if (parsed.errorResponse) return parsed.errorResponse;

	const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
	const session = await readRecentlyAuthenticatedSession(env, user.id, sessionToken);
	if (!session || session.organizationId !== user.organizationId) {
		return apiError("Recent authentication required", 403);
	}
	const limited = await enforceRateLimit(
		rateLimitUser(env, user.id, "external-account-connect", 10, 60 * 60 * 1000),
		{
			unavailableLog: "External account connection rate limit unavailable",
			limitedMessage: "Too many external account connections",
			respond: (message, status) => apiError(message, status),
		},
	);
	if (limited) return limited;

	try {
		const result = await beginExternalOAuth(env, {
			userId: user.id,
			organizationId: user.organizationId,
			sessionId: session.id,
			...parsed.data,
		});
		if (result.status === "forbidden") return apiError("External account not found", 404);
		return apiSuccess({ redirectTo: result.redirectTo }, 201);
	} catch {
		return apiError("External account connection could not be started", 503);
	}
});
