import { cookies } from "next/headers";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { isSameOriginMutation } from "@/lib/mcp/authorization-request";
import { revokeMcpConnection } from "@/lib/mcp/connections";

export const DELETE = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const appUrl = env.PUBLIC_APP_URL;
	if (!appUrl) return apiError("OAuth is unavailable", 503);
	if (!isSameOriginMutation(request, appUrl)) return apiError("Forbidden", 403);
	if (!user.organizationId) return apiError("No active organization", 403);
	const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
	const session = await readRecentlyAuthenticatedSession(env, user.id, sessionToken);
	if (!session || session.organizationId !== user.organizationId) {
		return apiError("Recent authentication required", 403);
	}
	try {
		const result = await revokeMcpConnection(env as Parameters<typeof revokeMcpConnection>[0], {
			connectionId: params.id,
			userId: user.id,
			organizationId: user.organizationId,
			requestId: newId("req"),
		});
		if (result.status === "not-found") return apiError("Connection not found", 404);
		return apiSuccess({ revoked: true });
	} catch {
		return apiError("Connection could not be revoked", 503);
	}
});
