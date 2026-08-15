import { z } from "zod";
import type { ExternalProvider } from "./types";

const CONFIGURATION_ERROR = "External OAuth is not configured correctly";
const CALLBACK_PATH = "/api/external-accounts/oauth/callback";

type ExternalFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

type ProviderConfiguration = {
	provider: ExternalProvider;
	clientId: string;
	clientSecret: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	identityEndpoint: string;
	scopes: readonly string[];
	redirectUri: string;
};

export type ExternalOAuthTokens = {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	scope: string;
};

export type ExternalOAuthRefreshErrorCode =
	| "authorization_revoked"
	| "provider_throttled"
	| "provider_unavailable"
	| "invalid_token_response";

export class ExternalOAuthRefreshError extends Error {
	readonly code: ExternalOAuthRefreshErrorCode;
	readonly retryable: boolean;

	constructor(code: ExternalOAuthRefreshErrorCode, retryable: boolean) {
		super("External OAuth token refresh failed");
		this.name = "ExternalOAuthRefreshError";
		this.code = code;
		this.retryable = retryable;
	}
}

function encodeBase64Url(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(value.byteLength);
	copy.set(value);
	return copy.buffer;
}

export async function createPkcePair(bytes = crypto.getRandomValues(new Uint8Array(32))): Promise<{
	verifier: string;
	challenge: string;
}> {
	if (bytes.length !== 32) throw new Error("External OAuth PKCE source is invalid");
	const verifier = encodeBase64Url(bytes);
	const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(new TextEncoder().encode(verifier)));
	return { verifier, challenge: encodeBase64Url(new Uint8Array(digest)) };
}

export function createExternalOauthStateToken(
	bytes = crypto.getRandomValues(new Uint8Array(32)),
): string {
	if (bytes.length !== 32) throw new Error("External OAuth state source is invalid");
	return encodeBase64Url(bytes);
}

export function normalizePublicAppOrigin(value: string | undefined): string {
	try {
		if (!value) throw new Error(CONFIGURATION_ERROR);
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
			url.search || url.hash) throw new Error(CONFIGURATION_ERROR);
		return url.origin;
	} catch {
		throw new Error(CONFIGURATION_ERROR);
	}
}

export function getExternalOAuthProvider(
	env: CloudflareEnv,
	provider: ExternalProvider,
): ProviderConfiguration {
	const origin = normalizePublicAppOrigin(env.PUBLIC_APP_URL);
	const redirectUri = `${origin}${CALLBACK_PATH}`;
	if (provider === "google") {
		if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new Error(CONFIGURATION_ERROR);
		return {
			provider,
			clientId: env.GOOGLE_OAUTH_CLIENT_ID,
			clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
			authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
			tokenEndpoint: "https://oauth2.googleapis.com/token",
			identityEndpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
			scopes: [
				"openid",
				"email",
				"https://www.googleapis.com/auth/gmail.readonly",
				"https://www.googleapis.com/auth/gmail.send",
			],
			redirectUri,
		};
	}
	if (provider === "microsoft") {
		if (!env.MICROSOFT_OAUTH_CLIENT_ID || !env.MICROSOFT_OAUTH_CLIENT_SECRET) throw new Error(CONFIGURATION_ERROR);
		return {
			provider,
			clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
			clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
			authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
			tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
			identityEndpoint: "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
			scopes: ["openid", "email", "offline_access", "User.Read", "Mail.Read", "Mail.Send"],
			redirectUri,
		};
	}
	throw new Error("External OAuth provider is unsupported");
}

export function buildExternalAuthorizationUrl(
	env: CloudflareEnv,
	provider: ExternalProvider,
	input: { state: string; codeChallenge: string },
): string {
	const configuration = getExternalOAuthProvider(env, provider);
	const url = new URL(configuration.authorizationEndpoint);
	url.searchParams.set("client_id", configuration.clientId);
	url.searchParams.set("redirect_uri", configuration.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", configuration.scopes.join(" "));
	url.searchParams.set("state", input.state);
	url.searchParams.set("code_challenge", input.codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("prompt", provider === "google" ? "consent" : "select_account");
	if (provider === "google") {
		url.searchParams.set("access_type", "offline");
		url.searchParams.set("include_granted_scopes", "true");
	} else {
		url.searchParams.set("response_mode", "query");
	}
	return url.toString();
}

const tokenResponseSchema = z.object({
	access_token: z.string().min(1).max(16_384),
	refresh_token: z.string().min(1).max(16_384),
	expires_in: z.number().int().positive().max(604_800),
	scope: z.string().max(4096).optional(),
	token_type: z.string().optional(),
}).passthrough();

const refreshTokenResponseSchema = z.object({
	access_token: z.string().min(1).max(16_384),
	refresh_token: z.string().min(1).max(16_384).optional(),
	expires_in: z.number().int().positive().max(604_800),
	scope: z.string().max(4096).optional(),
}).passthrough();

export async function exchangeExternalAuthorizationCode(
	env: CloudflareEnv,
	provider: ExternalProvider,
	code: string,
	codeVerifier: string,
	fetcher: ExternalFetch = fetch,
): Promise<ExternalOAuthTokens> {
	const configuration = getExternalOAuthProvider(env, provider);
	const body = new URLSearchParams({
		client_id: configuration.clientId,
		client_secret: configuration.clientSecret,
		code,
		code_verifier: codeVerifier,
		redirect_uri: configuration.redirectUri,
		grant_type: "authorization_code",
	});
	const response = await fetcher(configuration.tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	if (!response.ok) throw new Error("External OAuth code exchange failed");
	let raw: unknown;
	try {
		raw = await response.json();
	} catch {
		throw new Error("External OAuth token response is invalid");
	}
	const parsed = tokenResponseSchema.safeParse(raw);
	if (!parsed.success) throw new Error("External OAuth token response is invalid");
	return {
		accessToken: parsed.data.access_token,
		refreshToken: parsed.data.refresh_token,
		expiresIn: parsed.data.expires_in,
		scope: parsed.data.scope ?? configuration.scopes.join(" "),
	};
}

export async function refreshExternalAccessToken(
	env: CloudflareEnv,
	provider: ExternalProvider,
	refreshToken: string,
	fetcher: ExternalFetch = fetch,
): Promise<ExternalOAuthTokens> {
	const configuration = getExternalOAuthProvider(env, provider);
	const body = new URLSearchParams({
		client_id: configuration.clientId,
		client_secret: configuration.clientSecret,
		refresh_token: refreshToken,
		grant_type: "refresh_token",
		scope: configuration.scopes.join(" "),
	});
	const response = await fetcher(configuration.tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	if (!response.ok) {
		let errorCode: unknown;
		try {
			errorCode = (await response.json() as { error?: unknown }).error;
		} catch {
			// Provider error bodies are intentionally discarded.
		}
		if (errorCode === "invalid_grant") {
			throw new ExternalOAuthRefreshError("authorization_revoked", false);
		}
		if (response.status === 429) {
			throw new ExternalOAuthRefreshError("provider_throttled", true);
		}
		throw new ExternalOAuthRefreshError("provider_unavailable", response.status >= 500);
	}
	let raw: unknown;
	try {
		raw = await response.json();
	} catch {
		throw new ExternalOAuthRefreshError("invalid_token_response", false);
	}
	const parsed = refreshTokenResponseSchema.safeParse(raw);
	if (!parsed.success) throw new ExternalOAuthRefreshError("invalid_token_response", false);
	return {
		accessToken: parsed.data.access_token,
		refreshToken: parsed.data.refresh_token ?? refreshToken,
		expiresIn: parsed.data.expires_in,
		scope: parsed.data.scope ?? configuration.scopes.join(" "),
	};
}

export async function revokeExternalRefreshToken(
	provider: ExternalProvider,
	refreshToken: string,
	fetcher: ExternalFetch = fetch,
): Promise<void> {
	if (provider === "microsoft") return;
	const response = await fetcher("https://oauth2.googleapis.com/revoke", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ token: refreshToken }).toString(),
	});
	if (!response.ok) throw new Error("External OAuth token revocation failed");
}

const providerAddress = z.string().trim().toLowerCase().email().max(320);

export async function fetchExternalIdentity(
	provider: ExternalProvider,
	accessToken: string,
	fetcher: ExternalFetch = fetch,
): Promise<string> {
	const identityEndpoint = provider === "google"
		? "https://gmail.googleapis.com/gmail/v1/users/me/profile"
		: "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
	const response = await fetcher(identityEndpoint, {
		headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
	});
	if (!response.ok) throw new Error("External provider identity lookup failed");
	let raw: unknown;
	try {
		raw = await response.json();
	} catch {
		throw new Error("External provider identity response is invalid");
	}
	const candidate = raw && typeof raw === "object"
		? provider === "google"
			? (raw as { emailAddress?: unknown }).emailAddress
			: (raw as { mail?: unknown; userPrincipalName?: unknown }).mail ||
				(raw as { userPrincipalName?: unknown }).userPrincipalName
		: undefined;
	const parsed = providerAddress.safeParse(candidate);
	if (!parsed.success) throw new Error("External provider identity response is invalid");
	return parsed.data;
}
