export const MCP_READ_SCOPE = "mail.read";
export const MCP_ACTION_SCOPE = "mail.actions";

export type McpConsentProfile = "read" | "actions";
export type McpScope = typeof MCP_READ_SCOPE | typeof MCP_ACTION_SCOPE;

type GrantBinding = {
	userId: string;
	organizationId: string;
	sessionId: string;
	connectionId: string;
};

type ActiveGrantBinding = GrantBinding & { connectionRevoked: boolean };

export function canonicalMcpResource(publicAppUrl: string): string {
	const url = new URL(publicAppUrl);
	if (url.protocol !== "https:") throw new Error("MCP resource requires HTTPS");
	if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
		throw new Error("PUBLIC_APP_URL must be an origin");
	}
	return new URL("/mcp", url.origin).toString();
}

export function selectConsentProfile(
	selected: McpConsentProfile | undefined,
	requestedScopes: readonly string[],
): McpConsentProfile {
	return selected === "actions" && requestedScopes.includes(MCP_ACTION_SCOPE) ? "actions" : "read";
}

export function grantedScopesForProfile(profile: McpConsentProfile): McpScope[] {
	return profile === "actions" ? [MCP_READ_SCOPE, MCP_ACTION_SCOPE] : [MCP_READ_SCOPE];
}

export function hasMcpScope(scopes: readonly string[], required: McpScope): boolean {
	return scopes.includes(required);
}

export function isGrantBindingActive(
	binding: GrantBinding,
	active: Omit<ActiveGrantBinding, "sessionId"> & { sessionId: string | null },
): boolean {
	return !active.connectionRevoked &&
		binding.userId === active.userId &&
		binding.organizationId === active.organizationId &&
		binding.sessionId === active.sessionId &&
		binding.connectionId === active.connectionId;
}
