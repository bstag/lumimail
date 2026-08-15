import { and, eq, gt } from "drizzle-orm";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { getDb } from "@/db";
import { mcpConnections, organizationMembers, sessions, users } from "@/db/schema";
import { MCP_READ_SCOPE, hasMcpScope } from "@/lib/mcp/security";

export type McpGrantProps = {
	connectionId: string;
	userId: string;
	organizationId: string;
	sessionId: string;
};

export type AuthorizedMcpRequest = {
	token: string;
	clientId: string;
	scopes: string[];
	expiresAt: number;
	resource?: URL;
	props: McpGrantProps;
};

function isGrantProps(value: unknown): value is McpGrantProps {
	if (!value || typeof value !== "object") return false;
	const props = value as Record<string, unknown>;
	return ["connectionId", "userId", "organizationId", "sessionId"]
		.every((key) => typeof props[key] === "string" && props[key].length > 0);
}

function bearerToken(request: Request): string | null {
	const header = request.headers.get("authorization");
	if (!header?.startsWith("Bearer ")) return null;
	return header.slice(7).trim() || null;
}

export async function authorizeMcpRequest(
	env: CloudflareEnv & { OAUTH_PROVIDER: OAuthHelpers },
	request: Request,
	now = new Date(),
): Promise<AuthorizedMcpRequest | null> {
	const token = bearerToken(request);
	if (!token) return null;
	const summary = await env.OAUTH_PROVIDER.unwrapToken<McpGrantProps>(token);
	if (!summary || !isGrantProps(summary.grant.props) || !hasMcpScope(summary.scope, MCP_READ_SCOPE)) return null;
	const props = summary.grant.props;
	if (summary.userId !== props.userId) return null;

	const db = getDb(env);
	const [active] = await db
		.select({ connectionId: mcpConnections.id })
		.from(mcpConnections)
		.innerJoin(users, eq(users.id, mcpConnections.userId))
		.innerJoin(sessions, eq(sessions.id, mcpConnections.approvingSessionId))
		.innerJoin(organizationMembers, and(
			eq(organizationMembers.userId, mcpConnections.userId),
			eq(organizationMembers.organizationId, mcpConnections.organizationId),
		))
		.where(and(
			eq(mcpConnections.id, props.connectionId),
			eq(mcpConnections.userId, props.userId),
			eq(mcpConnections.organizationId, props.organizationId),
			eq(mcpConnections.approvingSessionId, props.sessionId),
			eq(mcpConnections.status, "active"),
			eq(users.organizationId, props.organizationId),
			eq(sessions.userId, props.userId),
			gt(sessions.expiresAt, now),
		))
		.limit(1);
	if (!active) return null;

	await db.update(mcpConnections).set({ lastUsedAt: now }).where(eq(mcpConnections.id, props.connectionId));
	const audience = Array.isArray(summary.audience) ? summary.audience[0] : summary.audience;
	return {
		token,
		clientId: summary.grant.clientId,
		scopes: summary.scope,
		expiresAt: summary.expiresAt,
		...(audience ? { resource: new URL(audience) } : {}),
		props,
	};
}
