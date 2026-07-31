import type { MessageFolder } from "@/hooks/types";

/** Drafts poll for shared-draft edits made by other mailbox members. */
export const DRAFTS_REFRESH_INTERVAL_MS = 10_000;
/** Sent polls faster, but only while a delivery is still in flight. */
export const SENT_DELIVERY_REFRESH_INTERVAL_MS = 5_000;

/**
 * Polling cadence for a folder's message-list query, as a TanStack
 * `refetchInterval`. Drafts always poll (a colleague may be editing a shared
 * draft); Sent polls only while queued deliveries are present so a settled
 * folder makes no background requests. Other folders do not poll. TanStack
 * pauses interval refetches while the window is unfocused/hidden, which
 * replaces the old document-visibility gate.
 */
export function getMessagesRefetchInterval(
	folder: MessageFolder,
	statuses: readonly string[],
): number | false {
	if (folder === "drafts") return DRAFTS_REFRESH_INTERVAL_MS;
	if (folder === "sent" && statuses.includes("queued")) return SENT_DELIVERY_REFRESH_INTERVAL_MS;
	return false;
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
