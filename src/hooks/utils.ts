import { apiJson } from "@/lib/api/client-response";
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

/**
 * Statuses a label view lists: everything the messages API accepts except
 * `trash` and `spam`. Written as an allowlist rather than an exclusion so a
 * future status has to be considered deliberately instead of appearing in
 * label views by default.
 */
export const LABEL_VISIBLE_STATUSES = [
	"received",
	"sent",
	"draft",
	"queued",
	"failed",
	"archived",
] as const;

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

	// Archive holds mail in both directions, so unlike Inbox and Sent it
	// constrains status alone.
	if (folder === "archived") {
		params.set("status", "archived");
	}

	// A label spans folders, so it constrains `labelId` (set from `filters`
	// below) rather than status — except that trashed and spam mail stays out.
	// A label is a filing destination; deleted mail that happens to still carry
	// the label is not something the user filed there.
	if (folder === "label") {
		params.set("status", LABEL_VISIBLE_STATUSES.join(","));
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
	const data = await apiJson.get<{ counts?: MessageCounts }>(
		`/api/messages/counts${query ? `?${query}` : ""}`,
	);
	return data.counts;
}

export async function fetchMessageList(params: URLSearchParams): Promise<MessageListResponse> {
	return apiJson.get<MessageListResponse>(`/api/messages?${params.toString()}`);
}
