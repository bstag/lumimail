export function buildOAuthAuthorizationRequest(publicAppUrl: string, authorizationQuery: string): Request {
	if (!authorizationQuery.startsWith("?") || authorizationQuery.length > 4096 || authorizationQuery.includes("#")) {
		throw new Error("Invalid authorization request");
	}
	const origin = new URL(publicAppUrl).origin;
	return new Request(`${origin}/oauth/authorize${authorizationQuery}`);
}

export function isSameOriginMutation(request: Request, publicAppUrl: string): boolean {
	const origin = request.headers.get("origin");
	return origin === new URL(publicAppUrl).origin && new URL(request.url).origin === origin;
}
