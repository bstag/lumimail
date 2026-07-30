import { authFetch } from "@/lib/auth/client";
import type { MessageFilterOptions, MessageFolder } from "./types";
import type { MessageCounts, MessageListResponse } from "./types";

export function parseMessageSearchQuery(query: string): MessageFilterOptions {
	let remaining = query;
	const filters: MessageFilterOptions = {};
	const titleMatch = remaining.match(/\btitle:"([^"]+)"/i) ?? remaining.match(/\btitle:([^\s]+)/i);

	if (titleMatch?.[1]) {
		filters.title = titleMatch[1].trim();
		remaining = remaining.replace(titleMatch[0], " ");
	}

	if (/(^|\s):unread(\s|$)/i.test(remaining)) {
		filters.read = "unread";
		remaining = remaining.replace(/(^|\s):unread(?=\s|$)/gi, " ");
	} else if (/(^|\s):read(\s|$)/i.test(remaining)) {
		filters.read = "read";
		remaining = remaining.replace(/(^|\s):read(?=\s|$)/gi, " ");
	}

	const textQuery = remaining.replace(/\s+/g, " ").trim();
	if (textQuery) filters.query = textQuery;

	return filters;
}

export function getMessageQueryParams(
	folder: MessageFolder,
	mailboxId?: string | null,
	filters?: MessageFilterOptions,
) {
	const params = new URLSearchParams();

	if (folder === "inbox") {
		params.set("direction", "inbound");
		params.set("status", "received");
	}

	if (folder === "sent") {
		params.set("direction", "outbound");
		params.set("status", "queued,sent,failed");
	}

	if (folder === "drafts") {
		params.set("direction", "outbound");
		params.set("status", "draft");
	}

	if (folder === "trash" || folder === "spam") {
		params.set("status", folder);
	}

	if (folder === "starred") {
		params.set("starred", "true");
	}

	if (mailboxId) params.set("mailboxId", mailboxId);
	const parsedFilters = filters?.query ? { ...filters, ...parseMessageSearchQuery(filters.query) } : filters;
	if (parsedFilters?.query?.trim()) params.set("q", parsedFilters.query.trim());
	if (parsedFilters?.title?.trim()) params.set("title", parsedFilters.title.trim());
	if (parsedFilters?.read && parsedFilters.read !== "all") params.set("read", parsedFilters.read);
	if (filters?.limit) params.set("limit", String(filters.limit));
	if (filters?.offset) params.set("offset", String(filters.offset));
	if (filters?.labelId) params.set("labelId", filters.labelId);

	return params;
}

/**
 * Plain fetchers for the message endpoints. Caching, request dedupe, and
 * cross-component invalidation all belong to TanStack Query now (T-34): these
 * run as `queryFn`s under `messageKeys` from `src/lib/query-keys.ts`, and the
 * account-switch isolation contract (F50) is met by the root QueryClient
 * clearing itself via the account-state reset coordinator.
 */
export async function fetchMessageCounts(mailboxId?: string | null): Promise<MessageCounts | undefined> {
	const params = new URLSearchParams();
	if (mailboxId) params.set("mailboxId", mailboxId);
	const query = params.toString();
	const res = await authFetch(`/api/messages/counts${query ? `?${query}` : ""}`);
	const data = (await res.json()) as { counts?: MessageCounts };
	return data.counts;
}

export async function fetchMessageList(params: URLSearchParams): Promise<MessageListResponse> {
	const res = await authFetch(`/api/messages?${params.toString()}`);
	return (await res.json()) as MessageListResponse;
}
