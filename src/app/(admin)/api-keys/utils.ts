import { authFetch } from "@/lib/auth/client";
import { parseScopes } from "@/lib/api-keys";
import type { ApiKey } from "./types";

export { parseScopes as parseApiKeyScopes };

export interface CreatedApiKey {
	id: string;
	name: string;
	prefix: string;
	key: string;
}

async function readApiKeyResponse<T>(response: Response): Promise<T> {
	const body = (await response.json()) as T & { error?: string };
	if (!response.ok) throw new Error(body.error ?? "API key request failed");
	return body;
}

export async function listApiKeys(): Promise<ApiKey[]> {
	const response = await authFetch("/api/api-keys");
	return (await readApiKeyResponse<{ apiKeys: ApiKey[] }>(response)).apiKeys;
}

export async function createApiKey(name: string): Promise<CreatedApiKey> {
	const response = await authFetch("/api/api-keys", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, scopes: ["send", "read"] }),
	});
	return readApiKeyResponse<CreatedApiKey>(response);
}

export async function revokeApiKey(id: string): Promise<void> {
	const response = await authFetch(`/api/api-keys/${id}`, { method: "DELETE" });
	await readApiKeyResponse<{ ok: true }>(response);
}

export function formatApiKeyTimestamp(
	value: string | null | undefined,
	locale?: string,
	timeZone?: string,
): string {
	if (!value) return "Never";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown";
	return new Intl.DateTimeFormat(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZone,
		timeZoneName: "short",
	}).format(date);
}
