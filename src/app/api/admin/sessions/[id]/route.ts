import { cookies } from "next/headers";
import { withOrgOwner } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getBearerToken } from "@/lib/auth/cookies";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { revokeOrganizationSession } from "@/lib/session-revocation";

export const DELETE = withOrgOwner<{ id: string }>(async ({ request, env, user, params }) => {
	const bearerToken = getBearerToken(request);
	const cookieToken = bearerToken ? undefined : (await cookies()).get(SESSION_COOKIE)?.value;
	const result = await revokeOrganizationSession(env, {
		organizationId: user.organizationId,
		actorUserId: user.id,
		currentToken: bearerToken ?? cookieToken,
		targetSessionId: params.id,
		requestId: newId("req"),
	});
	if (result.status === "recent-auth-required") return apiError("Recent authentication required", 403);
	if (result.status === "not-found") return apiError("Session not found", 404);
	if (result.status === "current-session") return apiError("Use logout to end the current session", 409);
	return apiSuccess({ revokedCount: result.revokedCount, requestId: result.requestId });
});
