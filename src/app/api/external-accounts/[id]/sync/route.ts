import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requestExternalAccountSync } from "@/lib/email/external/account-management";
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
	const limited = await enforceRateLimit(
		rateLimitUser(env, user.id, "external-account-sync", 30, 60 * 60 * 1000),
		{
			unavailableLog: "External account sync rate limit unavailable",
			limitedMessage: "Too many external account sync requests",
			respond: (message, status) => apiError(message, status),
		},
	);
	if (limited) return limited;
	const result = await requestExternalAccountSync(env, user.id, user.organizationId, params.id);
	if (result.status === "not-found") return apiError("External account not found", 404);
	if (result.status === "conflict") return apiError("External account cannot sync in its current state", 409);
	return apiSuccess({ jobId: result.jobId }, 202);
});
