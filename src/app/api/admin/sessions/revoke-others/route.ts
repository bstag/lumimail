import { cookies } from "next/headers";
import { withOrgOwner } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { getBearerToken } from "@/lib/auth/cookies";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { revokeOtherOrganizationSessions } from "@/lib/session-revocation";

export const POST = withOrgOwner(async ({ request, env, user }) => {
	const bearerToken = getBearerToken(request);
	const cookieToken = bearerToken ? undefined : (await cookies()).get(SESSION_COOKIE)?.value;
	const result = await revokeOtherOrganizationSessions(env, {
		organizationId: user.organizationId,
		actorUserId: user.id,
		currentToken: bearerToken ?? cookieToken,
		requestId: newId("req"),
	});
	if (result.status === "recent-auth-required") return apiError("Recent authentication required", 403);
	return apiSuccess({ revokedCount: result.revokedCount, requestId: result.requestId });
});
