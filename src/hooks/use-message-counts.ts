"use client";

import { useQuery } from "@tanstack/react-query";
import type { MessageCounts } from "./types";
import { fetchMessageCounts } from "./utils";
import { messageKeys } from "@/lib/query-keys";

const emptyCounts: MessageCounts = {
	folders: {
		inbox: { total: 0, unread: 0 },
		sent: { total: 0, unread: 0 },
		drafts: { total: 0, unread: 0 },
		archived: { total: 0, unread: 0 },
		spam: { total: 0, unread: 0 },
		trash: { total: 0, unread: 0 },
		starred: { total: 0, unread: 0 },
	},
	mailboxes: [],
};

/**
 * Folder/mailbox unread counts backed by TanStack Query (T-34). Lives under
 * the shared `messageKeys` prefix, so every mutation that calls
 * `invalidateMessageQueries` refreshes counts and lists together.
 */
export function useMessageCounts(mailboxId?: string | null, enabled = true) {
	const countsQuery = useQuery({
		queryKey: messageKeys.counts(mailboxId ?? null),
		enabled,
		// TanStack treats `undefined` query data as an error; fall back to the
		// zeroed shape the old hook rendered for an empty payload.
		queryFn: async () => (await fetchMessageCounts(mailboxId)) ?? emptyCounts,
		staleTime: 0,
		refetchOnWindowFocus: true,
		retry: false,
	});

	return {
		counts: countsQuery.data ?? emptyCounts,
		isLoading: enabled && countsQuery.isPending,
	};
}
