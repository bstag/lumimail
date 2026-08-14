import { and, desc, eq } from "drizzle-orm";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { getDb } from "@/db";
import { mcpConnections, securityAuditEvents } from "@/db/schema";
import { newId } from "@/lib/ids";
import {
	grantedScopesForProfile,
	selectConsentProfile,
	type McpConsentProfile,
} from "@/lib/mcp/security";

type McpOAuthEnv = CloudflareEnv & { OAUTH_PROVIDER: OAuthHelpers };
const MAX_REVOKE_GRANT_PAGES = 5;

function clientDisplayName(value: string | undefined): string {
	const clean = value?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100);
	return clean || "OAuth client";
}

async function parsedClient(env: McpOAuthEnv, request: Request) {
	const oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
	const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
	if (!client) throw new Error("Unknown OAuth client");
	return { oauthRequest, clientName: clientDisplayName(client.clientName) };
}

export async function inspectMcpAuthorization(env: McpOAuthEnv, request: Request) {
	const { oauthRequest, clientName } = await parsedClient(env, request);
	return {
		clientName,
		requestedScopes: oauthRequest.scope,
		defaultProfile: "read" as const,
	};
}

export async function denyMcpAuthorization(env: McpOAuthEnv, request: Request): Promise<{ redirectTo: string }> {
	const { oauthRequest } = await parsedClient(env, request);
	const redirect = new URL(oauthRequest.redirectUri);
	redirect.searchParams.set("error", "access_denied");
	redirect.searchParams.set("error_description", "The user denied the authorization request");
	if (oauthRequest.state) redirect.searchParams.set("state", oauthRequest.state);
	if (oauthRequest.issuer) redirect.searchParams.set("iss", oauthRequest.issuer);
	return { redirectTo: redirect.toString() };
}

type ApproveArgs = {
	request: Request;
	userId: string;
	organizationId: string;
	sessionId: string;
	profile: McpConsentProfile;
	requestId: string;
	now?: Date;
};

function auditValues(
	args: { userId: string; organizationId: string; requestId: string },
	action: "mcp.authorize" | "mcp.revoke",
	connectionId: string,
	now: Date,
) {
	return {
		id: newId("aud"),
		organizationId: args.organizationId,
		actorUserId: args.userId,
		action,
		resourceType: "mcp_connection" as const,
		resourceId: connectionId,
		affectedCount: 1,
		requestId: args.requestId,
		outcome: "succeeded" as const,
		createdAt: now,
	};
}

export async function approveMcpConnection(env: McpOAuthEnv, args: ApproveArgs) {
	const now = args.now ?? new Date();
	const { oauthRequest, clientName } = await parsedClient(env, args.request);
	const profile = selectConsentProfile(args.profile, oauthRequest.scope);
	const scopes = grantedScopesForProfile(profile);
	const connectionId = newId("mcp");
	const db = getDb(env);

	await db.insert(mcpConnections).values({
		id: connectionId,
		userId: args.userId,
		organizationId: args.organizationId,
		approvingSessionId: args.sessionId,
		clientId: oauthRequest.clientId,
		clientName,
		profile,
		scopes: JSON.stringify(scopes),
		status: "pending",
		createdAt: now,
	});

	let redirectTo: string;
	try {
		({ redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
			request: oauthRequest,
			userId: args.userId,
			metadata: { connectionId, clientName, profile },
			scope: scopes,
			props: {
				connectionId,
				userId: args.userId,
				organizationId: args.organizationId,
				sessionId: args.sessionId,
			},
			revokeExistingGrants: false,
		}));
	} catch (error) {
		await db.delete(mcpConnections).where(and(
			eq(mcpConnections.id, connectionId),
			eq(mcpConnections.status, "pending"),
		));
		throw error;
	}

	await db.batch([
		db.update(mcpConnections).set({ status: "active" }).where(and(
			eq(mcpConnections.id, connectionId),
			eq(mcpConnections.status, "pending"),
		)),
		db.insert(securityAuditEvents).values(auditValues(args, "mcp.authorize", connectionId, now)),
	]);
	return { redirectTo, connectionId };
}

export async function listMcpConnections(env: CloudflareEnv, userId: string) {
	const rows = await getDb(env)
		.select({
			id: mcpConnections.id,
			clientName: mcpConnections.clientName,
			profile: mcpConnections.profile,
			status: mcpConnections.status,
			createdAt: mcpConnections.createdAt,
			lastUsedAt: mcpConnections.lastUsedAt,
			revokedAt: mcpConnections.revokedAt,
		})
		.from(mcpConnections)
		.where(eq(mcpConnections.userId, userId))
		.orderBy(desc(mcpConnections.createdAt));
	return { connections: rows.map((row) => ({
		...row,
		createdAt: row.createdAt.toISOString(),
		lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
		revokedAt: row.revokedAt?.toISOString() ?? null,
	})) };
}

type RevokeArgs = {
	connectionId: string;
	userId: string;
	organizationId: string;
	requestId: string;
	now?: Date;
};

function metadataConnectionId(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") return null;
	const value = (metadata as Record<string, unknown>).connectionId;
	return typeof value === "string" ? value : null;
}

export async function revokeMcpConnection(env: McpOAuthEnv, args: RevokeArgs): Promise<{
	status: "not-found" | "revoked";
}> {
	const db = getDb(env);
	const [connection] = await db
		.select({ id: mcpConnections.id, organizationId: mcpConnections.organizationId, status: mcpConnections.status })
		.from(mcpConnections)
		.where(and(
			eq(mcpConnections.id, args.connectionId),
			eq(mcpConnections.userId, args.userId),
			eq(mcpConnections.organizationId, args.organizationId),
		))
		.limit(1);
	if (!connection) return { status: "not-found" };

	let cursor: string | undefined;
	for (let page = 0; page < MAX_REVOKE_GRANT_PAGES; page += 1) {
		const grants = await env.OAUTH_PROVIDER.listUserGrants(args.userId, { limit: 1000, ...(cursor ? { cursor } : {}) });
		for (const grant of grants.items) {
			if (metadataConnectionId(grant.metadata) === args.connectionId) {
				await env.OAUTH_PROVIDER.revokeGrant(grant.id, args.userId);
			}
		}
		cursor = grants.cursor;
		if (!cursor) break;
	}
	if (cursor) throw new Error("Too many OAuth grants to revoke safely");

	if (connection.status !== "revoked") {
		const now = args.now ?? new Date();
		await db.batch([
			db.update(mcpConnections).set({ status: "revoked", revokedAt: now }).where(and(
				eq(mcpConnections.id, args.connectionId),
				eq(mcpConnections.userId, args.userId),
			)),
			db.insert(securityAuditEvents).values(auditValues(args, "mcp.revoke", args.connectionId, now)),
		]);
	}
	return { status: "revoked" };
}
