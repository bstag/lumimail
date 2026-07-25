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

/**
 * Recovery emits mail, so the affordance follows the same send-capability rule as
 * Compose and Drafts in F48. The API enforces this independently; hiding the
 * control simply avoids offering an action that would be refused.
 */
export function canRecoverMessage(
	folder: MessageFolder,
	status: string,
	canSend: boolean,
): boolean {
	return folder === "sent" && status === "failed" && canSend;
}
