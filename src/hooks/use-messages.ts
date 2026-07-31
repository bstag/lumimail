"use client";

import { useCallback, useMemo } from "react";
import type { SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Message, MessageFilterOptions, MessageFolder, MessageListResponse } from "./types";
import { fetchMessageList, getMessageQueryParams } from "./utils";
import { messageKeys } from "@/lib/query-keys";
import { getMessagesRefetchInterval } from "@/components/messages/message-folder-utils";

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
				mailboxId: mailboxId ?? null,
				query: query ?? null,
				read: read ?? null,
				title: title ?? null,
				limit: requestedLimit ?? null,
				offset: requestedOffset ?? null,
				labelId: labelId ?? null,
			}),
		[folder, labelId, mailboxId, query, read, requestedLimit, requestedOffset, title],
	);

	const listQuery = useQuery({
		queryKey,
		enabled,
		queryFn: () =>
			fetchMessageList(
				getMessageQueryParams(folder, mailboxId, {
					labelId,
					limit: requestedLimit,
					offset: requestedOffset,
					query,
					read,
					title,
				}),
			),
		// A mutation must always be reflected on the next focus/poll, matching
		// the old force-refresh listeners.
		staleTime: 0,
		refetchOnWindowFocus: true,
		// The old fetch path made a single attempt and rendered the empty state.
		retry: false,
		refetchInterval: (queryState) =>
			getMessagesRefetchInterval(
				folder,
				(queryState.state.data?.messages ?? []).map((message) => message.status),
			),
		// Keep the previous page rendered while a new page/filter loads, as the
		// old hook did (it only overwrote rows once the response arrived).
		placeholderData: (previous?: MessageListResponse) => previous,
	});

	const data = listQuery.data;
	const messages = useMemo(() => data?.messages ?? [], [data]);
	const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.read).length;

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
		isLoading: listQuery.isPending || listQuery.isPlaceholderData,
		total: data?.total ?? 0,
		limit: data?.limit ?? requestedLimit ?? 25,
		offset: data?.offset ?? requestedOffset ?? 0,
	};
}
