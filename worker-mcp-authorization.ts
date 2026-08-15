import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { getUserFromSession, SESSION_COOKIE } from "./src/lib/auth/session";
import { readRecentlyAuthenticatedSession } from "./src/lib/auth/recent-auth";
import { newId } from "./src/lib/ids";
import { buildOAuthAuthorizationRequest, isSameOriginMutation } from "./src/lib/mcp/authorization-request";
import { approveMcpConnection, denyMcpAuthorization, inspectMcpAuthorization } from "./src/lib/mcp/connections";
import { enforceRateLimit, rateLimitUser } from "./src/lib/rate-limit";

type AuthorizationEnv = CloudflareEnv & { OAUTH_PROVIDER: OAuthHelpers };
const approvalSchema = z.object({
	authorizationQuery: z.string().min(2).max(4096),
	decision: z.enum(["approve", "deny"]),
	profile: z.enum(["read", "actions"]).optional(),
}).strict();

function api(data: unknown, status = 200) {
	return Response.json(data, { status });
}

function error(message: string, status: number) {
	return api({ success: false, error: { message } }, status);
}

function sessionToken(request: Request): string | undefined {
	const authorization = request.headers.get("authorization");
	if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim() || undefined;
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const [name, ...value] = part.trim().split("=");
		if (name === SESSION_COOKIE) return value.join("=") || undefined;
	}
	return undefined;
}

export async function handleMcpAuthorizationRequest(request: Request, env: AuthorizationEnv): Promise<Response> {
	const appUrl = env.PUBLIC_APP_URL;
	if (!appUrl) return error("OAuth is unavailable", 503);
	const token = sessionToken(request);
	const user = await getUserFromSession(env, token);
	if (!user) return error("Unauthorized", 401);

	if (request.method === "GET") {
		const query = new URL(request.url).searchParams.get("authorizationQuery");
		if (!query) return error("Invalid authorization request", 400);
		try {
			const summary = await inspectMcpAuthorization(env, buildOAuthAuthorizationRequest(appUrl, query));
			return api({ success: true, data: summary });
		} catch {
			return error("Invalid authorization request", 400);
		}
	}
	if (request.method !== "POST") return error("Method not allowed", 405);
	if (!isSameOriginMutation(request, appUrl)) return error("Forbidden", 403);
	if (!user.organizationId) return error("No active organization", 403);
	const parsed = approvalSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return error("Invalid authorization request", 400);
	let oauthRequest: Request;
	try {
		oauthRequest = buildOAuthAuthorizationRequest(appUrl, parsed.data.authorizationQuery);
	} catch {
		return error("Invalid authorization request", 400);
	}
	if (parsed.data.decision === "deny") {
		try {
			return api({ success: true, data: await denyMcpAuthorization(env, oauthRequest) });
		} catch {
			return error("Invalid authorization request", 400);
		}
	}
	if (!parsed.data.profile) return error("profile: Required", 400);
	const session = await readRecentlyAuthenticatedSession(env, user.id, token);
	if (!session || session.organizationId !== user.organizationId) return error("Recent authentication required", 403);
	const limited = await enforceRateLimit(rateLimitUser(env, user.id, "mcp-authorization", 20, 60 * 60 * 1000), {
		unavailableLog: "MCP authorization rate limit unavailable",
		limitedMessage: "Too many authorization approvals",
		respond: (message, status) => error(message, status),
	});
	if (limited) return limited;
	try {
		const result = await approveMcpConnection(env, {
			request: oauthRequest, userId: user.id, organizationId: user.organizationId,
			sessionId: session.id, profile: parsed.data.profile, requestId: newId("req"),
		});
		return api({ success: true, data: { redirectTo: result.redirectTo } }, 201);
	} catch {
		return error("Authorization could not be completed", 503);
	}
}
