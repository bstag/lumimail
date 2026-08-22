"use client";

import { useCallback, useMemo } from "react";
import type { SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Message, MessageFilterOptions, MessageFolder, MessageListResponse } from "./types";
import { fetchMessageList, getMessageQueryParams } from "./utils";
import { messageKeys } from "@/lib/query-keys";
import { getMessagesRefetchInterval } from "@/components/messages/message-folder-utils";

function fetchMessagesForQuery(
	folder: MessageFolder,
	mailboxId: string | null | undefined,
	filters: MessageFilterOptions,
) {
	return fetchMessageList(getMessageQueryParams(folder, mailboxId, filters));
}

function refetchIntervalForFolder(
	folder: MessageFolder,
	queryState: { state: { data?: MessageListResponse } },
) {
	return getMessagesRefetchInterval(
		folder,
		(queryState.state.data?.messages ?? []).map((message) => message.status),
	);
}

function nullable<T>(value: T | undefined) {
	return value ?? null;
}

function paginationValue(value: number | undefined, requested: number | undefined, fallback: number) {
	return value ?? requested ?? fallback;
}

function unreadMessageCount(messages: Message[]) {
	return messages.filter((message) => message.direction === "inbound" && !message.read).length;
}

function messagesFromResponse(data: MessageListResponse | undefined) {
	return data?.messages ?? [];
}

function queryIsLoading(isPending: boolean, isPlaceholderData: boolean) {
	return isPending || isPlaceholderData;
}

/**
 * Folder message list backed by TanStack Query (T-34).
 *
 * Freshness model:
 * - mutations call `invalidateMessageQueries`, which refetches every mounted
 *   message query (the replacement for the old `lumimail:messages-changed`
 *   window event);
 * - regaining window focus refetches (replaces the old focus/visibility
 *   listeners);
 * - Drafts and Sent poll via `getMessagesRefetchInterval` (10s shared-draft
 *   cadence; 5s delivery cadence while queued sends exist), and TanStack
 *   pauses the interval while the window is unfocused.
 */
export function useMessages(
	folder: MessageFolder,
	mailboxId?: string | null,
	filters?: MessageFilterOptions,
	enabled = true,
) {
	const queryClient = useQueryClient();
	const {
		labelId,
		limit: requestedLimit,
		offset: requestedOffset,
		query,
		read,
		title,
	} = filters ?? {};

	const queryKey = useMemo(
		() =>
			messageKeys.list(folder, {
				mailboxId: nullable(mailboxId),
				query: nullable(query),
				read: nullable(read),
				title: nullable(title),
				limit: nullable(requestedLimit),
				offset: nullable(requestedOffset),
				labelId: nullable(labelId),
			}),
		[folder, labelId, mailboxId, query, read, requestedLimit, requestedOffset, title],
	);
	const queryFilters = {
		labelId,
		limit: requestedLimit,
		offset: requestedOffset,
		query,
		read,
		title,
	};
	const queryFn: () => Promise<MessageListResponse> = fetchMessagesForQuery.bind(
		undefined,
		folder,
		mailboxId,
		queryFilters,
	);
	const refetchInterval = refetchIntervalForFolder.bind(undefined, folder);

	const listQuery = useQuery({
		queryKey,
		enabled,
		queryFn,
		// A mutation must always be reflected on the next focus/poll, matching
		// the old force-refresh listeners.
		staleTime: 0,
		refetchOnWindowFocus: true,
		// The old fetch path made a single attempt and rendered the empty state.
		retry: false,
		refetchInterval,
		// Keep the previous page rendered while a new page/filter loads, as the
		// old hook did (it only overwrote rows once the response arrived).
		placeholderData: (previous?: MessageListResponse) => previous,
	});

	const data = listQuery.data;
	const messages = useMemo(() => messagesFromResponse(data), [data]);
	const unreadCount = unreadMessageCount(messages);

	/**
	 * Optimistic row updates (star toggles, etc.) write straight into the
	 * cached list for this query key — the TanStack equivalent of the old
	 * `setMessages` state setter.
	 */
	const setMessages = useCallback(
		(update: SetStateAction<Message[]>) => {
			queryClient.setQueryData<MessageListResponse>(queryKey, (current) => {
				const currentMessages = current?.messages ?? [];
				const nextMessages = typeof update === "function" ? update(currentMessages) : update;
				return { ...current, messages: nextMessages };
			});
		},
		[queryClient, queryKey],
	);

	return {
		messages,
		setMessages,
		unreadCount,
		isLoading: queryIsLoading(listQuery.isPending, listQuery.isPlaceholderData),
		total: paginationValue(data?.total, undefined, 0),
		limit: paginationValue(data?.limit, requestedLimit, 25),
		offset: paginationValue(data?.offset, requestedOffset, 0),
	};
}
