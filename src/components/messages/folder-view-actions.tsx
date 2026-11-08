"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MessageFolder } from "@/hooks/types";
import type { InboxFocus } from "./inbox-focus-utils";
import { useSelectAllInView } from "./bulk-cleanup";
import { runViewAction, viewQuery, type ViewQuery } from "./bulk-cleanup-utils";
import { SenderGroups, useGroupBySender } from "./sender-groups";
import { runBulkMessageAction } from "./utils";

type FolderView = {
	folder: MessageFolder;
	mailboxId: string | null | undefined;
	query: string;
	labelId: string | null;
	focus: InboxFocus | undefined;
	messageIds: string[];
	selectedIds: string[];
	total: number;
};

/**
 * What a folder list needs for whole-view actions (F102) and sender grouping (F103): the
 * view's query, whether the page or the whole view is selected, how many messages a bulk
 * action will touch, and that action itself.
 */
export function useFolderViewActions({ folder, mailboxId, query, labelId, focus, messageIds, selectedIds, total }: FolderView) {
	const queryClient = useQueryClient();
	const allVisibleSelected = messageIds.length > 0 && messageIds.every((id) => selectedIds.includes(id));
	const view = useMemo(
		() => viewQuery(folder, mailboxId, { query, labelId: labelId ?? undefined, focus }),
		[folder, mailboxId, query, labelId, focus],
	);
	const selection = useSelectAllInView(view, allVisibleSelected);
	const groupToggle = useGroupBySender();
	return {
		view,
		allVisibleSelected,
		selection,
		selectedCount: selection.allInView ? total : selectedIds.length,
		// Grouping is an Inbox view; other folders keep the flat list.
		grouped: groupToggle[0] && focus !== undefined,
		groupToggle,
		run: (action: string) => selection.allInView
			? runViewAction(queryClient, view, action)
			: runBulkMessageAction(queryClient, selectedIds, action),
	};
}

/** The grouped sender list when grouping is on, otherwise the flat list it is given. */
export function FolderListBody({ grouped, view, children }: { grouped: boolean; view: ViewQuery; children: React.ReactNode }) {
	return grouped ? <SenderGroups view={view} /> : <>{children}</>;
}
