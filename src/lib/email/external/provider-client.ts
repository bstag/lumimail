import { z } from "zod";
import type { ExternalImportMode } from "./types";

type ExternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ExternalRemoteChange = {
	remoteMessageId: string;
	remoteThreadId?: string;
	remoteFolderKey: "inbox" | "sent" | "archive" | "unknown";
	remoteRevision?: string;
	removed: boolean;
	rawMime?: Uint8Array;
};

export type GoogleSyncCursor = { historyId?: string; pageToken?: string };
export type MicrosoftSyncCursor = { url: string; complete: boolean };

export type ExternalSyncPage<TCursor> = {
	changes: ExternalRemoteChange[];
	cursor: TCursor;
	hasMore: boolean;
};

export type ExternalProviderErrorCode =
	| "authorization_revoked"
	| "cursor_expired"
	| "provider_throttled"
	| "provider_unavailable"
	| "invalid_provider_response"
	| "message_too_large";

export class ExternalProviderRequestError extends Error {
	readonly code: ExternalProviderErrorCode;
	readonly retryable: boolean;

	constructor(code: ExternalProviderErrorCode, retryable: boolean) {
		super("External provider request failed");
		this.name = "ExternalProviderRequestError";
		this.code = code;
		this.retryable = retryable;
	}
}

const MAX_PAGE_SIZE = 10;
const MAX_MIME_BYTES = 30 * 1024 * 1024;

async function parseProviderJson(response: Response, cursorRequest = false): Promise<unknown> {
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) {
			throw new ExternalProviderRequestError("authorization_revoked", false);
		}
		if (cursorRequest && (response.status === 404 || response.status === 410)) {
			throw new ExternalProviderRequestError("cursor_expired", false);
		}
		if (response.status === 429) {
			throw new ExternalProviderRequestError("provider_throttled", true);
		}
		throw new ExternalProviderRequestError("provider_unavailable", response.status >= 500);
	}
	try {
		return await response.json();
	} catch {
		throw new ExternalProviderRequestError("invalid_provider_response", false);
	}
}

function authorizationHeaders(accessToken: string, extra?: HeadersInit): Headers {
	const headers = new Headers(extra);
	headers.set("authorization", `Bearer ${accessToken}`);
	return headers;
}

const gmailProfileSchema = z.object({ historyId: z.string().min(1).max(128) }).passthrough();
const gmailListSchema = z.object({
	messages: z.array(z.object({
		id: z.string().min(1).max(1024),
		threadId: z.string().min(1).max(1024).optional(),
	}).passthrough()).max(MAX_PAGE_SIZE).optional(),
	nextPageToken: z.string().min(1).max(4096).optional(),
}).passthrough();
const gmailMessageSchema = z.object({
	id: z.string().min(1).max(1024),
	threadId: z.string().min(1).max(1024).optional(),
	labelIds: z.array(z.string().max(256)).max(100).optional(),
	historyId: z.string().max(128).optional(),
	raw: z.string().min(1).max(Math.ceil(MAX_MIME_BYTES * 4 / 3) + 16),
}).passthrough();
const gmailHistoryMessageSchema = z.object({
	id: z.string().min(1).max(1024),
	threadId: z.string().min(1).max(1024).optional(),
}).passthrough();
const gmailHistorySchema = z.object({
	history: z.array(z.object({
		messagesAdded: z.array(z.object({ message: gmailHistoryMessageSchema }).passthrough()).max(MAX_PAGE_SIZE).optional(),
		messagesDeleted: z.array(z.object({ message: gmailHistoryMessageSchema }).passthrough()).max(MAX_PAGE_SIZE).optional(),
	}).passthrough()).max(MAX_PAGE_SIZE).optional(),
	nextPageToken: z.string().min(1).max(4096).optional(),
	historyId: z.string().min(1).max(128),
}).passthrough();

function decodeBase64Url(value: string): Uint8Array {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
	let binary: string;
	try {
		binary = atob(padded);
	} catch {
		throw new ExternalProviderRequestError("invalid_provider_response", false);
	}
	if (binary.length > MAX_MIME_BYTES) {
		throw new ExternalProviderRequestError("message_too_large", false);
	}
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function gmailFolder(labelIds: readonly string[] | undefined): "inbox" | "sent" | "archive" {
	if (labelIds?.includes("SENT")) return "sent";
	if (labelIds?.includes("INBOX")) return "inbox";
	return "archive";
}

async function fetchGmailMessage(
	accessToken: string,
	messageId: string,
	fetcher: ExternalFetch,
): Promise<ExternalRemoteChange> {
	const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
	url.searchParams.set("format", "raw");
	const parsed = gmailMessageSchema.safeParse(await parseProviderJson(await fetcher(url, {
		headers: authorizationHeaders(accessToken, { accept: "application/json" }),
	})));
	if (!parsed.success || parsed.data.id !== messageId) {
		throw new ExternalProviderRequestError("invalid_provider_response", false);
	}
	return {
		remoteMessageId: parsed.data.id,
		remoteThreadId: parsed.data.threadId,
		remoteFolderKey: gmailFolder(parsed.data.labelIds),
		remoteRevision: parsed.data.historyId,
		removed: false,
		rawMime: decodeBase64Url(parsed.data.raw),
	};
}

export async function fetchGoogleSyncPage(
	input: {
		accessToken: string;
		mode: "initial" | "incremental";
		importMode: ExternalImportMode;
		cursor?: GoogleSyncCursor;
	},
	fetcher: ExternalFetch = fetch,
): Promise<ExternalSyncPage<GoogleSyncCursor>> {
	if (input.mode === "initial" && input.importMode === "from_now" && !input.cursor?.pageToken) {
		const parsed = gmailProfileSchema.safeParse(await parseProviderJson(await fetcher(
			"https://gmail.googleapis.com/gmail/v1/users/me/profile",
			{ headers: authorizationHeaders(input.accessToken, { accept: "application/json" }) },
		)));
		if (!parsed.success) throw new ExternalProviderRequestError("invalid_provider_response", false);
		return { changes: [], cursor: { historyId: parsed.data.historyId }, hasMore: false };
	}

	if (input.mode === "initial") {
		const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
		url.searchParams.set("maxResults", String(MAX_PAGE_SIZE));
		url.searchParams.set("q", "newer_than:30d -in:spam -in:trash -in:drafts");
		if (input.cursor?.pageToken) url.searchParams.set("pageToken", input.cursor.pageToken);
		const parsed = gmailListSchema.safeParse(await parseProviderJson(await fetcher(url, {
			headers: authorizationHeaders(input.accessToken, { accept: "application/json" }),
		})));
		if (!parsed.success) throw new ExternalProviderRequestError("invalid_provider_response", false);
		const changes = await Promise.all((parsed.data.messages ?? []).map((message) =>
			fetchGmailMessage(input.accessToken, message.id, fetcher)));
		if (parsed.data.nextPageToken) {
			return { changes, cursor: { pageToken: parsed.data.nextPageToken }, hasMore: true };
		}
		const profile = gmailProfileSchema.safeParse(await parseProviderJson(await fetcher(
			"https://gmail.googleapis.com/gmail/v1/users/me/profile",
			{ headers: authorizationHeaders(input.accessToken, { accept: "application/json" }) },
		)));
		if (!profile.success) throw new ExternalProviderRequestError("invalid_provider_response", false);
		return { changes, cursor: { historyId: profile.data.historyId }, hasMore: false };
	}

	if (!input.cursor?.historyId) {
		throw new ExternalProviderRequestError("cursor_expired", false);
	}
	const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
	url.searchParams.set("startHistoryId", input.cursor.historyId);
	url.searchParams.set("maxResults", String(MAX_PAGE_SIZE));
	url.searchParams.append("historyTypes", "messageAdded");
	url.searchParams.append("historyTypes", "messageDeleted");
	if (input.cursor.pageToken) url.searchParams.set("pageToken", input.cursor.pageToken);
	const parsed = gmailHistorySchema.safeParse(await parseProviderJson(await fetcher(url, {
		headers: authorizationHeaders(input.accessToken, { accept: "application/json" }),
	}), true));
	if (!parsed.success) throw new ExternalProviderRequestError("invalid_provider_response", false);
	const additions = new Map<string, { id: string; threadId?: string }>();
	const removals = new Map<string, { id: string; threadId?: string }>();
	for (const history of parsed.data.history ?? []) {
		for (const added of history.messagesAdded ?? []) additions.set(added.message.id, added.message);
		for (const removed of history.messagesDeleted ?? []) removals.set(removed.message.id, removed.message);
	}
	const addedChanges = await Promise.all([...additions.values()].map((message) =>
		fetchGmailMessage(input.accessToken, message.id, fetcher)));
	const removedChanges = [...removals.values()].map((message): ExternalRemoteChange => ({
		remoteMessageId: message.id,
		remoteThreadId: message.threadId,
		remoteFolderKey: "unknown",
		removed: true,
	}));
	return {
		changes: [...addedChanges, ...removedChanges],
		cursor: parsed.data.nextPageToken
			? { historyId: input.cursor.historyId, pageToken: parsed.data.nextPageToken }
			: { historyId: parsed.data.historyId },
		hasMore: Boolean(parsed.data.nextPageToken),
	};
}

export type MicrosoftFolder = "inbox" | "sent" | "archive";
const microsoftFolderNames: Record<MicrosoftFolder, string> = {
	inbox: "inbox",
	sent: "sentitems",
	archive: "archive",
};
const graphMessageSchema = z.object({
	id: z.string().min(1).max(2048),
	conversationId: z.string().min(1).max(2048).optional(),
	"@odata.etag": z.string().max(4096).optional(),
	"@removed": z.object({ reason: z.string().max(128).optional() }).passthrough().optional(),
}).passthrough();
const graphDeltaSchema = z.object({
	value: z.array(graphMessageSchema).max(MAX_PAGE_SIZE),
	"@odata.nextLink": z.string().max(16_384).optional(),
	"@odata.deltaLink": z.string().max(16_384).optional(),
}).passthrough();

function validateGraphCursor(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("External provider cursor is invalid");
	}
	if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com" || url.username ||
		url.password || url.hash) throw new Error("External provider cursor is invalid");
	return url.toString();
}

async function fetchGraphMime(
	accessToken: string,
	messageId: string,
	fetcher: ExternalFetch,
): Promise<Uint8Array> {
	const response = await fetcher(
		`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/$value`,
		{ headers: authorizationHeaders(accessToken, { accept: "message/rfc822" }) },
	);
	if (!response.ok) {
		await parseProviderJson(response);
	}
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_MIME_BYTES) {
		throw new ExternalProviderRequestError("message_too_large", false);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > MAX_MIME_BYTES) {
		throw new ExternalProviderRequestError("message_too_large", false);
	}
	return bytes;
}

export async function fetchMicrosoftSyncPage(
	input: {
		accessToken: string;
		folder: MicrosoftFolder;
		importMode: ExternalImportMode;
		cursor?: MicrosoftSyncCursor;
	},
	fetcher: ExternalFetch = fetch,
	now = new Date(),
): Promise<ExternalSyncPage<MicrosoftSyncCursor>> {
	let requestUrl: string;
	if (input.cursor) {
		requestUrl = validateGraphCursor(input.cursor.url);
	} else {
		const url = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${microsoftFolderNames[input.folder]}/messages/delta`);
		url.searchParams.set("$select", "id,conversationId,@odata.etag");
		const start = input.importMode === "recent_30_days"
			? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
			: now;
		url.searchParams.set("$filter", `receivedDateTime ge ${start.toISOString()}`);
		url.searchParams.set("$orderby", "receivedDateTime desc");
		url.searchParams.set("$top", String(MAX_PAGE_SIZE));
		requestUrl = url.toString();
	}
	const parsed = graphDeltaSchema.safeParse(await parseProviderJson(await fetcher(requestUrl, {
		headers: authorizationHeaders(input.accessToken, {
			accept: "application/json",
			Prefer: `odata.maxpagesize=${MAX_PAGE_SIZE}`,
		}),
	}), Boolean(input.cursor)));
	if (!parsed.success || (!parsed.data["@odata.nextLink"] && !parsed.data["@odata.deltaLink"])) {
		throw new ExternalProviderRequestError("invalid_provider_response", false);
	}
	const changes: ExternalRemoteChange[] = [];
	for (const message of parsed.data.value) {
		if (message["@removed"]) {
			changes.push({ remoteMessageId: message.id, remoteFolderKey: input.folder, removed: true });
		} else {
			changes.push({
				remoteMessageId: message.id,
				remoteThreadId: message.conversationId,
				remoteFolderKey: input.folder,
				remoteRevision: message["@odata.etag"],
				removed: false,
				rawMime: await fetchGraphMime(input.accessToken, message.id, fetcher),
			});
		}
	}
	const nextLink = parsed.data["@odata.nextLink"];
	const cursorUrl = validateGraphCursor(nextLink ?? parsed.data["@odata.deltaLink"]!);
	return {
		changes,
		cursor: { url: cursorUrl, complete: !nextLink },
		hasMore: Boolean(nextLink),
	};
}
