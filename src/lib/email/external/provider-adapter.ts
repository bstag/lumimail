import { z } from "zod";
import type { OutboundSendResult } from "@/lib/email/providers/types";
import { OutboundProviderError } from "@/lib/email/providers/types";
import {
	buildExternalAuthorizationUrl,
	exchangeExternalAuthorizationCode,
	fetchExternalIdentity,
	refreshExternalAccessToken,
	revokeExternalRefreshToken,
	type ExternalOAuthTokens,
} from "./oauth-provider";
import {
	ExternalProviderRequestError,
	fetchGoogleSyncPage,
	fetchMicrosoftSyncPage,
	type ExternalRemoteChange,
	type GoogleSyncCursor,
	type MicrosoftFolder,
	type MicrosoftSyncCursor,
} from "./provider-client";
import type { ExternalImportMode, ExternalProvider } from "./types";

type ExternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ExternalCursorMutation = {
	key: string;
	type: "gmail_history" | "microsoft_delta";
	value: GoogleSyncCursor | MicrosoftSyncCursor;
};

export type ExternalProviderSyncPage = {
	changes: ExternalRemoteChange[];
	cursors: ExternalCursorMutation[];
	hasMore: boolean;
};

export type ExternalProviderSyncInput = {
	accessToken: string;
	mode: "initial" | "incremental";
	importMode: ExternalImportMode;
	readCursor: (key: string) => Promise<unknown>;
	fetcher?: ExternalFetch;
	now?: Date;
};

export type ExternalProviderAdapter = {
	provider: ExternalProvider;
	buildAuthorizationUrl: (
		env: CloudflareEnv,
		input: { state: string; codeChallenge: string },
	) => string;
	exchangeAuthorizationCode: (
		env: CloudflareEnv,
		code: string,
		verifier: string,
	) => Promise<ExternalOAuthTokens>;
	fetchIdentity: (accessToken: string, fetcher?: ExternalFetch) => Promise<string>;
	refreshAccessToken: (
		env: CloudflareEnv,
		refreshToken: string,
		fetcher?: ExternalFetch,
	) => Promise<ExternalOAuthTokens>;
	revokeRefreshToken: (refreshToken: string, fetcher?: ExternalFetch) => Promise<void>;
	fetchSyncPage: (input: ExternalProviderSyncInput) => Promise<ExternalProviderSyncPage>;
	sendMessage: (accessToken: string, rawMime: string, fetcher?: ExternalFetch) => Promise<OutboundSendResult>;
};

const googleCursorSchema = z.object({
	historyId: z.string().min(1).max(128).optional(),
	pageToken: z.string().min(1).max(4096).optional(),
}).strict();
const microsoftCursorSchema = z.object({
	url: z.string().min(1).max(16_384),
	complete: z.boolean(),
}).strict();
const MICROSOFT_FOLDERS: readonly MicrosoftFolder[] = ["inbox", "sent", "archive"];

function parseCursor<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
	if (value === undefined) return undefined;
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new ExternalProviderRequestError("cursor_expired", false);
	return parsed.data;
}

function encodeBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function encodeBase64Url(value: string): string {
	return encodeBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function providerSendFailure(status: number): OutboundProviderError {
	return new OutboundProviderError(`External provider send failed (${status})`, {
		code: `EXTERNAL_HTTP_${status}`,
		retryable: status === 429 || status >= 500,
	});
}

async function sendGoogleMessage(
	accessToken: string,
	rawMime: string,
	fetcher: ExternalFetch = fetch,
): Promise<OutboundSendResult> {
	const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
		method: "POST",
		headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
		body: JSON.stringify({ raw: encodeBase64Url(rawMime) }),
	});
	if (!response.ok) throw providerSendFailure(response.status);
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new OutboundProviderError("External provider response was invalid", {
			code: "EXTERNAL_INVALID_RESPONSE", retryable: false,
		});
	}
	const id = body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string"
		? (body as { id: string }).id : null;
	if (!id) throw new OutboundProviderError("External provider response was invalid", {
		code: "EXTERNAL_INVALID_RESPONSE", retryable: false,
	});
	return { providerMessageId: id };
}

async function sendMicrosoftMessage(
	accessToken: string,
	rawMime: string,
	fetcher: ExternalFetch = fetch,
): Promise<OutboundSendResult> {
	const response = await fetcher("https://graph.microsoft.com/v1.0/me/sendMail", {
		method: "POST",
		headers: { authorization: `Bearer ${accessToken}`, "content-type": "text/plain" },
		body: encodeBase64(rawMime),
	});
	if (!response.ok) throw providerSendFailure(response.status);
	const messageId = /^Message-ID:\s*(<[^\r\n]+>)/im.exec(rawMime)?.[1];
	if (!messageId) throw new OutboundProviderError("Generated external message has no Message-ID", {
		code: "EXTERNAL_INVALID_MESSAGE", retryable: false,
	});
	return { providerMessageId: messageId };
}

function buildProviderAuthorizationUrl(
	provider: ExternalProvider,
	env: CloudflareEnv,
	input: { state: string; codeChallenge: string },
) {
	return buildExternalAuthorizationUrl(env, provider, input);
}

function exchangeProviderAuthorizationCode(
	provider: ExternalProvider,
	env: CloudflareEnv,
	code: string,
	verifier: string,
) {
	return exchangeExternalAuthorizationCode(env, provider, code, verifier);
}

function fetchProviderIdentity(
	provider: ExternalProvider,
	accessToken: string,
	fetcher?: ExternalFetch,
) {
	return fetchExternalIdentity(provider, accessToken, fetcher);
}

function refreshProviderAccessToken(
	provider: ExternalProvider,
	env: CloudflareEnv,
	refreshToken: string,
	fetcher?: ExternalFetch,
) {
	return refreshExternalAccessToken(env, provider, refreshToken, fetcher);
}

function revokeProviderRefreshToken(
	provider: ExternalProvider,
	refreshToken: string,
	fetcher?: ExternalFetch,
) {
	return revokeExternalRefreshToken(provider, refreshToken, fetcher);
}

function oauthCapabilities(provider: ExternalProvider) {
	return {
		buildAuthorizationUrl: buildProviderAuthorizationUrl.bind(undefined, provider),
		exchangeAuthorizationCode: exchangeProviderAuthorizationCode.bind(undefined, provider),
		fetchIdentity: fetchProviderIdentity.bind(undefined, provider),
		refreshAccessToken: refreshProviderAccessToken.bind(undefined, provider),
		revokeRefreshToken: revokeProviderRefreshToken.bind(undefined, provider),
	};
}

const googleAdapter: ExternalProviderAdapter = {
	provider: "google",
	...oauthCapabilities("google"),
	async fetchSyncPage(input) {
		const cursor = parseCursor(googleCursorSchema, await input.readCursor("gmail"));
		const page = await fetchGoogleSyncPage({
			accessToken: input.accessToken,
			mode: input.mode,
			importMode: input.importMode,
			cursor,
		}, input.fetcher);
		return {
			changes: page.changes,
			cursors: [{ key: "gmail", type: "gmail_history", value: page.cursor }],
			hasMore: page.hasMore,
		};
	},
	sendMessage: sendGoogleMessage,
};

const microsoftAdapter: ExternalProviderAdapter = {
	provider: "microsoft",
	...oauthCapabilities("microsoft"),
	async fetchSyncPage(input) {
		const changes: ExternalRemoteChange[] = [];
		const cursors: ExternalCursorMutation[] = [];
		let hasMore = false;
		for (const folder of MICROSOFT_FOLDERS) {
			const cursor = parseCursor(microsoftCursorSchema, await input.readCursor(folder));
			const page = await fetchMicrosoftSyncPage({
				accessToken: input.accessToken,
				folder,
				importMode: input.importMode,
				cursor,
			}, input.fetcher, input.now);
			changes.push(...page.changes);
			cursors.push({ key: folder, type: "microsoft_delta", value: page.cursor });
			hasMore ||= page.hasMore;
		}
		return { changes, cursors, hasMore };
	},
	sendMessage: sendMicrosoftMessage,
};

export function getExternalProviderAdapter(provider: ExternalProvider): ExternalProviderAdapter {
	return provider === "google" ? googleAdapter : microsoftAdapter;
}
