import { apiJson } from "@/lib/api/client-response";
import { parseScopes } from "@/lib/api-keys";
import type { ApiKey } from "./types";

export { parseScopes as parseApiKeyScopes };

export interface CreatedApiKey {
	id: string;
	name: string;
	prefix: string;
	key: string;
}

export async function listApiKeys(): Promise<ApiKey[]> {
	return (await apiJson.get<{ apiKeys: ApiKey[] }>("/api/api-keys")).apiKeys;
}

export async function createApiKey(name: string): Promise<CreatedApiKey> {
	return apiJson.post<CreatedApiKey>("/api/api-keys", { name, scopes: ["send", "read"] });
}

export async function revokeApiKey(id: string): Promise<void> {
	await apiJson.delete<{ ok: true }>(`/api/api-keys/${id}`);
}

export type ApiKeyTimestampLabels = {
	/** Shown for a key that has never been used. */
	never: string;
	/** Shown for malformed stored metadata. */
	unknown: string;
};

export function formatApiKeyTimestamp(
	value: string | null | undefined,
	locale?: string,
	timeZone?: string,
	labels: ApiKeyTimestampLabels = { never: "Never", unknown: "Unknown" },
): string {
	if (!value) return labels.never;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return labels.unknown;
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
