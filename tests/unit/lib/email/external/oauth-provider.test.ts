import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildExternalAuthorizationUrl,
	createExternalOauthStateToken,
	createPkcePair,
	exchangeExternalAuthorizationCode,
	fetchExternalIdentity,
	getExternalOAuthProvider,
	normalizePublicAppOrigin,
	refreshExternalAccessToken,
	revokeExternalRefreshToken,
} from "@/lib/email/external/oauth-provider";

const env = {
	PUBLIC_APP_URL: "https://mail.example",
	GOOGLE_OAUTH_CLIENT_ID: "google-client",
	GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
	MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
	MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
} as CloudflareEnv;

describe("external OAuth provider contract", () => {
	it("creates an RFC 7636 S256 verifier and challenge", async () => {
		const pair = await createPkcePair(new Uint8Array(32).fill(1));
		expect(pair.verifier).toBe("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
		expect(pair.challenge).toBe("VtX6czP210fbQsI5QH5dpMMvTHnzXQkrE0_TWkAtnFw");
		expect((await createPkcePair()).verifier).toHaveLength(43);
		await expect(createPkcePair(new Uint8Array(31))).rejects.toThrow("External OAuth PKCE source is invalid");
		expect(createExternalOauthStateToken(new Uint8Array(32).fill(2))).toHaveLength(43);
		expect(createExternalOauthStateToken()).toHaveLength(43);
		expect(() => createExternalOauthStateToken(new Uint8Array(31))).toThrow("External OAuth state source is invalid");
	});

	it("requires one canonical HTTPS application origin", () => {
		expect(normalizePublicAppOrigin("https://mail.example/")).toBe("https://mail.example");
		for (const value of [
			undefined, "http://mail.example", "https://mail.example/path", "https://user@mail.example",
			"https://user:password@mail.example", "https://mail.example?query=1", "https://mail.example/#hash", "not-url",
		]) {
			expect(() => normalizePublicAppOrigin(value)).toThrow("External OAuth is not configured correctly");
		}
	});

	it("builds exact Google and Microsoft authorization requests", () => {
		const common = { state: "state_1", codeChallenge: "challenge_1" };
		const google = new URL(buildExternalAuthorizationUrl(env, "google", common));
		expect(`${google.origin}${google.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(Object.fromEntries(google.searchParams)).toMatchObject({
			client_id: "google-client",
			redirect_uri: "https://mail.example/api/external-accounts/oauth/callback",
			response_type: "code",
			access_type: "offline",
			prompt: "consent",
			state: "state_1",
			code_challenge: "challenge_1",
			code_challenge_method: "S256",
		});
		expect(google.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining([
			"openid", "email", "https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/gmail.send",
		]));

		const microsoft = new URL(buildExternalAuthorizationUrl(env, "microsoft", common));
		expect(`${microsoft.origin}${microsoft.pathname}`)
			.toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
		expect(microsoft.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining([
			"openid", "email", "offline_access", "User.Read", "Mail.Read", "Mail.Send",
		]));
	});

	it("fails closed when provider credentials are incomplete", () => {
		expect(() => getExternalOAuthProvider({ ...env, GOOGLE_OAUTH_CLIENT_ID: undefined }, "google"))
			.toThrow("External OAuth is not configured correctly");
		expect(() => getExternalOAuthProvider({ ...env, GOOGLE_OAUTH_CLIENT_SECRET: undefined }, "google"))
			.toThrow("External OAuth is not configured correctly");
		expect(() => getExternalOAuthProvider({ ...env, MICROSOFT_OAUTH_CLIENT_ID: undefined }, "microsoft"))
			.toThrow("External OAuth is not configured correctly");
		expect(() => getExternalOAuthProvider({ ...env, MICROSOFT_OAUTH_CLIENT_SECRET: undefined }, "microsoft"))
			.toThrow("External OAuth is not configured correctly");
		expect(() => getExternalOAuthProvider(env, "imap" as never))
			.toThrow("External OAuth provider is unsupported");
	});
});

describe("external OAuth provider HTTP exchange", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("exchanges a code without logging or returning provider error bodies", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			void input;
			void init;
			return new Response(JSON.stringify({
				access_token: "access-secret",
				refresh_token: "refresh-secret",
				expires_in: 3600,
				scope: "Mail.Read Mail.Send",
				token_type: "Bearer",
			}), { status: 200, headers: { "content-type": "application/json" } });
		});

		const result = await exchangeExternalAuthorizationCode(
			env, "microsoft", "authorization-code", "verifier", fetcher,
		);
		expect(result).toEqual({
			accessToken: "access-secret",
			refreshToken: "refresh-secret",
			expiresIn: 3600,
			scope: "Mail.Read Mail.Send",
		});
		const [url, options] = fetcher.mock.calls[0];
		expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
		expect(options?.method).toBe("POST");
		const body = new URLSearchParams(options?.body as string);
		expect(body.get("code_verifier")).toBe("verifier");
		expect(body.get("client_secret")).toBe("microsoft-secret");
	});

	it("rejects provider denial and malformed or refresh-token-free responses", async () => {
		await expect(exchangeExternalAuthorizationCode(env, "google", "code", "verifier",
			async () => new Response("provider secret detail", { status: 400 })))
			.rejects.toThrow("External OAuth code exchange failed");
		for (const body of [{}, { access_token: "a" }, { access_token: "a", refresh_token: "r", expires_in: -1 }]) {
			await expect(exchangeExternalAuthorizationCode(env, "google", "code", "verifier",
				async () => Response.json(body)))
				.rejects.toThrow("External OAuth token response is invalid");
		}
		await expect(exchangeExternalAuthorizationCode(env, "google", "code", "verifier",
			async () => new Response("not-json", { status: 200 })))
			.rejects.toThrow("External OAuth token response is invalid");
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
			access_token: "a", refresh_token: "r", expires_in: 60,
		}));
		expect((await exchangeExternalAuthorizationCode(env, "google", "code", "verifier")).scope)
			.toContain("gmail.readonly");
		fetchSpy.mockRestore();
	});

	it("reads the authoritative provider address instead of trusting browser input", async () => {
		expect(await fetchExternalIdentity("google", "token", async (url, options) => {
			expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
			expect(new Headers(options?.headers).get("authorization")).toBe("Bearer token");
			return Response.json({ emailAddress: " User@Example.com " });
		})).toBe("user@example.com");

		expect(await fetchExternalIdentity("microsoft", "token", async () =>
			Response.json({ mail: null, userPrincipalName: "Person@Example.com" })))
			.toBe("person@example.com");
	});

	it("rejects identity denial and invalid provider addresses", async () => {
		await expect(fetchExternalIdentity("google", "token", async () => new Response("denied", { status: 403 })))
			.rejects.toThrow("External provider identity lookup failed");
		await expect(fetchExternalIdentity("microsoft", "token", async () => Response.json({ mail: "not-mail" })))
			.rejects.toThrow("External provider identity response is invalid");
		await expect(fetchExternalIdentity("google", "token", async () => new Response("not-json", { status: 200 })))
			.rejects.toThrow("External provider identity response is invalid");
		await expect(fetchExternalIdentity("google", "token", async () => Response.json("not-object")))
			.rejects.toThrow("External provider identity response is invalid");
		expect(await fetchExternalIdentity("microsoft", "token", async () =>
			Response.json({ mail: "preferred@example.com", userPrincipalName: "fallback@example.com" })))
			.toBe("preferred@example.com");
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ emailAddress: "default@example.com" }));
		expect(await fetchExternalIdentity("google", "token")).toBe("default@example.com");
		fetchSpy.mockRestore();
	});

	it("refreshes delegated access and accepts provider refresh-token rotation", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			void input;
			void init;
			return Response.json({
				access_token: "new-access",
				refresh_token: "rotated-refresh",
				expires_in: 3600,
				scope: "Mail.Read Mail.Send",
			});
		});
		expect(await refreshExternalAccessToken(env, "microsoft", "old-refresh", fetcher)).toEqual({
			accessToken: "new-access",
			refreshToken: "rotated-refresh",
			expiresIn: 3600,
			scope: "Mail.Read Mail.Send",
		});
		const [, options] = fetcher.mock.calls[0];
		const body = new URLSearchParams(options?.body as string);
		expect(body.get("grant_type")).toBe("refresh_token");
		expect(body.get("refresh_token")).toBe("old-refresh");
		expect(body.get("scope")).toContain("offline_access");
	});

	it("keeps the old refresh token when Google omits a replacement and classifies authorization loss", async () => {
		expect(await refreshExternalAccessToken(env, "google", "refresh", async () => Response.json({
			access_token: "new-access", expires_in: 1800,
		}))).toMatchObject({ accessToken: "new-access", refreshToken: "refresh" });
		await expect(refreshExternalAccessToken(env, "google", "refresh", async () =>
			Response.json({ error: "invalid_grant", error_description: "secret detail" }, { status: 400 })))
			.rejects.toMatchObject({ name: "ExternalOAuthRefreshError", code: "authorization_revoked", retryable: false });
		await expect(refreshExternalAccessToken(env, "google", "refresh", async () =>
			new Response("throttled", { status: 429 })))
			.rejects.toMatchObject({ code: "provider_throttled", retryable: true });
		await expect(refreshExternalAccessToken(env, "google", "refresh", async () =>
			new Response("invalid", { status: 200 })))
			.rejects.toMatchObject({ code: "invalid_token_response", retryable: false });
		await expect(refreshExternalAccessToken(env, "google", "refresh", async () => Response.json({})))
			.rejects.toMatchObject({ code: "invalid_token_response", retryable: false });
		await expect(refreshExternalAccessToken(env, "google", "refresh", async () =>
			Response.json({ error: "temporarily_unavailable" }, { status: 400 })))
			.rejects.toMatchObject({ code: "provider_unavailable", retryable: false });
		await expect(refreshExternalAccessToken(env, "google", "refresh", async () =>
			new Response("down", { status: 503 })))
			.rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
		expect((await refreshExternalAccessToken(env, "google", "refresh", async () => Response.json({
			access_token: "new-access", expires_in: 1800, scope: "custom-scope",
		}))).scope).toBe("custom-scope");
	});

	it("revokes Google tokens without pretending Microsoft has a delegated revoke endpoint", async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
		await revokeExternalRefreshToken("google", "refresh-token", fetcher);
		expect(fetcher).toHaveBeenCalledWith("https://oauth2.googleapis.com/revoke", expect.objectContaining({
			method: "POST",
			body: "token=refresh-token",
		}));
		fetcher.mockClear();
		await revokeExternalRefreshToken("microsoft", "refresh-token", fetcher);
		expect(fetcher).not.toHaveBeenCalled();
		await expect(revokeExternalRefreshToken("google", "refresh-token", async () =>
			new Response(null, { status: 503 }))).rejects.toThrow("External OAuth token revocation failed");
	});
});
