import { cookies } from "next/headers";
import { z } from "zod";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { buildOAuthAuthorizationRequest, isSameOriginMutation } from "@/lib/mcp/authorization-request";
import { approveMcpConnection, denyMcpAuthorization, inspectMcpAuthorization } from "@/lib/mcp/connections";
import { enforceRateLimit, rateLimitUser } from "@/lib/rate-limit";

const approvalSchema = z.object({
	authorizationQuery: z.string().min(2).max(4096),
	decision: z.enum(["approve", "deny"]),
	profile: z.enum(["read", "actions"]).optional(),
}).strict();

function publicAppUrl(env: CloudflareEnv): string | null {
	return env.PUBLIC_APP_URL || null;
}

export const GET = withUser(async ({ request, env }) => {
	const appUrl = publicAppUrl(env);
	if (!appUrl) return apiError("OAuth is unavailable", 503);
	const authorizationQuery = new URL(request.url).searchParams.get("authorizationQuery");
	if (!authorizationQuery) return apiError("Invalid authorization request", 400);
	try {
		return apiSuccess(await inspectMcpAuthorization(
			env as Parameters<typeof inspectMcpAuthorization>[0],
			buildOAuthAuthorizationRequest(appUrl, authorizationQuery),
		));
	} catch {
		return apiError("Invalid authorization request", 400);
	}
});

export const POST = withUser(async ({ request, env, user }) => {
	const appUrl = publicAppUrl(env);
	if (!appUrl) return apiError("OAuth is unavailable", 503);
	if (!isSameOriginMutation(request, appUrl)) return apiError("Forbidden", 403);
	if (!user.organizationId) return apiError("No active organization", 403);
	const parsed = await parseJsonBody(request, approvalSchema);
	if (parsed.errorResponse) return parsed.errorResponse;

	let oauthRequest: Request;
	try {
		oauthRequest = buildOAuthAuthorizationRequest(appUrl, parsed.data.authorizationQuery);
	} catch {
		return apiError("Invalid authorization request", 400);
	}
	if (parsed.data.decision === "deny") {
		try {
			return apiSuccess(await denyMcpAuthorization(
				env as Parameters<typeof denyMcpAuthorization>[0], oauthRequest,
			));
		} catch {
			return apiError("Invalid authorization request", 400);
		}
	}
	if (!parsed.data.profile) return apiError("profile: Required", 400);
	const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
	const session = await readRecentlyAuthenticatedSession(env, user.id, sessionToken);
	if (!session || session.organizationId !== user.organizationId) {
		return apiError("Recent authentication required", 403);
	}
	const limited = await enforceRateLimit(
		rateLimitUser(env, user.id, "mcp-authorization", 20, 60 * 60 * 1000),
		{
			unavailableLog: "MCP authorization rate limit unavailable",
			limitedMessage: "Too many authorization approvals",
			respond: (message, status) => apiError(message, status),
		},
	);
	if (limited) return limited;
	try {
		const result = await approveMcpConnection(env as Parameters<typeof approveMcpConnection>[0], {
			request: oauthRequest,
			userId: user.id,
			organizationId: user.organizationId,
			sessionId: session.id,
			profile: parsed.data.profile,
			requestId: newId("req"),
		});
		return apiSuccess({ redirectTo: result.redirectTo }, 201);
	} catch {
		return apiError("Authorization could not be completed", 503);
	}
});
