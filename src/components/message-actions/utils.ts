import type { QueryClient } from "@tanstack/react-query";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import { invalidateMessageQueries } from "@/lib/query-keys";
import { authFetch } from "@/lib/auth/client";

export function getMessageBackHref(direction: "inbound" | "outbound", status: string) {
	if (status === "trash") return "/trash";
	if (status === "spam") return "/spam";
	if (status === "draft") return "/drafts";
	if (status === "archived") return "/archive";
	return direction === "inbound" ? "/inbox" : "/sent";
}

export async function runSingleMessageAction(
	queryClient: QueryClient,
	messageId: string,
	action: BulkMessageAction,
) {
	const response = await authFetch("/api/messages/bulk", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ messageIds: [messageId], action }),
	});

	if (!response.ok) {
		throw new Error("Unable to update message");
	}

	void invalidateMessageQueries(queryClient);
}

export function getMessageActionRedirect(action: BulkMessageAction, direction: "inbound" | "outbound") {
	if (action === "trash") return "/trash";
	if (action === "spam") return "/spam";
	if (action === "archive") return direction === "inbound" ? "/inbox" : "/sent";
	return null;
}
