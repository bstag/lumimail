import type { MessageFolder } from "@/hooks/types";

export function shouldRefreshSharedDrafts(
	folder: MessageFolder,
	visibilityState: DocumentVisibilityState,
): boolean {
	return folder === "drafts" && visibilityState === "visible";
}
