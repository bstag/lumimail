import { authFetch } from "@/lib/auth/client";
import { registerAccountStateReset } from "@/lib/auth/account-state";
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
		params.set("status", "sent");
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

const messageCountsCache = new Map<string, MessageCounts>();
const messageCountsRequests = new Map<string, Promise<MessageCounts | undefined>>();
const messageListCache = new Map<string, MessageListResponse>();
const messageListRequests = new Map<string, Promise<MessageListResponse>>();
let messageCountsGeneration = 0;
let messageListGeneration = 0;

export function clearMessageCountsCache() {
	messageCountsGeneration += 1;
	messageCountsCache.clear();
	messageCountsRequests.clear();
}

export function clearMessageListCache() {
	messageListGeneration += 1;
	messageListCache.clear();
	messageListRequests.clear();
}

registerAccountStateReset(() => {
	clearMessageCountsCache();
	clearMessageListCache();
});

export async function fetchMessageCounts(mailboxId?: string | null, force = false): Promise<MessageCounts | undefined> {
	const key = mailboxId ?? "all";
	if (!force && messageCountsCache.has(key)) return messageCountsCache.get(key);
	if (messageCountsRequests.has(key)) return messageCountsRequests.get(key);

	const requestGeneration = messageCountsGeneration;
	const request = (async () => {
		const params = new URLSearchParams();
		if (mailboxId) params.set("mailboxId", mailboxId);
		const query = params.toString();
		const res = await authFetch(`/api/messages/counts${query ? `?${query}` : ""}`);
		const data = (await res.json()) as { counts?: MessageCounts };
		const counts = data.counts;
		if (counts && messageCountsGeneration === requestGeneration) {
			messageCountsCache.set(key, counts);
		}
		return counts;
	})().finally(() => {
		if (messageCountsRequests.get(key) === request) {
			messageCountsRequests.delete(key);
		}
	});

	messageCountsRequests.set(key, request);
	return request;
}

export async function fetchMessageList(params: URLSearchParams, force = false): Promise<MessageListResponse> {
	const key = params.toString();
	if (!force && messageListCache.has(key)) return messageListCache.get(key) ?? {};
	if (messageListRequests.has(key)) return messageListRequests.get(key) ?? {};

	const requestGeneration = messageListGeneration;
	const request = authFetch(`/api/messages?${key}`)
		.then((res) => res.json())
		.then((data) => {
			const response = data as MessageListResponse;
			if (messageListGeneration === requestGeneration) {
				messageListCache.set(key, response);
			}
			return response;
		})
		.finally(() => {
			if (messageListRequests.get(key) === request) {
				messageListRequests.delete(key);
			}
		});

	messageListRequests.set(key, request);
	return request;
}
