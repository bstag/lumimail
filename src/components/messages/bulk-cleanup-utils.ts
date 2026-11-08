import type { QueryClient } from "@tanstack/react-query";
import { getMessageQueryParams } from "@/hooks/utils";
import type { MessageFilterOptions, MessageFolder } from "@/hooks/types";
import { apiJson } from "@/lib/api/client-response";
import { invalidateMessageQueries } from "@/lib/query-keys";

/** Ages the Inbox can be cleaned up by, in days (F102). */
export const CLEANUP_AGES = [7, 30, 90] as const;
/** Other mail older than a week above which the backlog prompt appears. */
export const BACKLOG_PROMPT_THRESHOLD = 200;
export const BACKLOG_DISMISSED_KEY = "picket:other-backlog-dismissed";

export type ViewQuery = Record<string, string>;

/** The list parameters of a view without paging: what "all in this view" means (F102). */
export function viewQuery(folder: MessageFolder, mailboxId: string | null | undefined, filters: MessageFilterOptions): ViewQuery {
	const params = getMessageQueryParams(folder, mailboxId, { ...filters, limit: undefined, offset: undefined });
	return Object.fromEntries(params);
}

export function olderThan(query: ViewQuery, days: number): ViewQuery {
	return { ...query, olderThanDays: String(days) };
}

/** How many messages a view-scoped bulk action would change. */
export async function previewViewAction(query: ViewQuery, action: string): Promise<number> {
	return (await apiJson.post<{ matched: number }>("/api/messages/bulk", { action, query, preview: true })).matched;
}

/** Runs a bulk action on every message a view shows; returns how many changed. */
export async function runViewAction(queryClient: QueryClient, query: ViewQuery, action: string): Promise<number> {
	const { updated } = await apiJson.post<{ updated: number }>("/api/messages/bulk", { action, query });
	void invalidateMessageQueries(queryClient);
	return updated;
}

export function readBacklogDismissed(): boolean {
	try {
		return globalThis.localStorage.getItem(BACKLOG_DISMISSED_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeBacklogDismissed() {
	try {
		globalThis.localStorage.setItem(BACKLOG_DISMISSED_KEY, "1");
	} catch {
		// Storage can be unavailable; the prompt then returns on the next visit.
	}
}
