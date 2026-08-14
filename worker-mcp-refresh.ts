import { sha256Hex } from "./src/lib/crypto-utils";
import { newId } from "./src/lib/ids";

const REFRESH_USE_RETENTION_SECONDS = 31 * 24 * 60 * 60;

function oauthError(error: "invalid_grant" | "server_error", description: string, status: number) {
	return Response.json({ error, error_description: description }, {
		status,
		headers: { "cache-control": "no-store", pragma: "no-cache" },
	});
}

async function refreshFields(request: Request) {
	try {
		return new URLSearchParams(await request.clone().text());
	} catch {
		return null;
	}
}

async function releaseClaim(env: CloudflareEnv, digest: string, claimId: string) {
	await env.DB.prepare(
		"DELETE FROM oauth_refresh_token_uses WHERE token_hash = ? AND claim_id = ?",
	).bind(digest, claimId).run();
}

export async function handleMcpOAuthTokenRequest(
	request: Request,
	env: CloudflareEnv,
	canonicalResource: string,
	providerFetch: (request: Request) => Promise<Response>,
	now: () => number = Date.now,
): Promise<Response> {
	const fields = await refreshFields(request);
	if (!fields || fields.get("grant_type") !== "refresh_token") return providerFetch(request);
	const requestedResource = fields.get("resource");
	// Let the provider return its authoritative invalid_target response without
	// consuming the otherwise-valid token's one-use claim.
	if (requestedResource && requestedResource !== canonicalResource) return providerFetch(request);
	const refreshToken = fields.get("refresh_token");
	if (!refreshToken || refreshToken.length > 4096) return providerFetch(request);

	const digest = await sha256Hex(refreshToken);
	const claimId = newId("rfc");
	const usedAt = Math.floor(now() / 1000);
	let claimed: { claimId: string } | null;
	try {
		claimed = await env.DB.prepare(`
			INSERT INTO oauth_refresh_token_uses (token_hash, claim_id, used_at, expires_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(token_hash) DO NOTHING
			RETURNING claim_id AS claimId
		`).bind(digest, claimId, usedAt, usedAt + REFRESH_USE_RETENTION_SECONDS)
			.first<{ claimId: string }>();
	} catch {
		return oauthError("server_error", "Refresh-token replay protection is unavailable", 503);
	}
	if (!claimed) return oauthError("invalid_grant", "Refresh token has already been used", 400);

	try {
		const response = await providerFetch(request);
		if (response.status !== 200) await releaseClaim(env, digest, claimId);
		return response;
	} catch (error) {
		await releaseClaim(env, digest, claimId);
		throw error;
	}
}

export async function purgeMcpRefreshTokenUses(
	env: CloudflareEnv,
	now: () => number = Date.now,
): Promise<void> {
	try {
		await env.DB.prepare("DELETE FROM oauth_refresh_token_uses WHERE expires_at <= ?")
			.bind(Math.floor(now() / 1000))
			.run();
	} catch {
		console.warn("OAuth refresh replay purge failed");
	}
}
