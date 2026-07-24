import type { MessageFolder } from "@/hooks/types";

export function shouldRefreshSharedDrafts(
	folder: MessageFolder,
	visibilityState: DocumentVisibilityState,
): boolean {
	return folder === "drafts" && visibilityState === "visible";
}

export function shouldRefreshDeliveryStatus(
	folder: MessageFolder,
	visibilityState: DocumentVisibilityState,
	statuses: string[],
): boolean {
	return folder === "sent" && visibilityState === "visible" && statuses.includes("queued");
}
