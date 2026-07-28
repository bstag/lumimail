import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import { notifyMessagesChanged } from "@/hooks/utils";
import { authFetch } from "@/lib/auth/client";

export function getMessageBackHref(direction: "inbound" | "outbound", status: string) {
	if (status === "trash") return "/trash";
	if (status === "spam") return "/spam";
	if (status === "draft") return "/drafts";
	return direction === "inbound" ? "/inbox" : "/sent";
}

export async function runSingleMessageAction(messageId: string, action: BulkMessageAction) {
	const response = await authFetch("/api/messages/bulk", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ messageIds: [messageId], action }),
	});

	if (!response.ok) {
		throw new Error("Unable to update message");
	}

	notifyMessagesChanged();
}

export function getMessageActionRedirect(action: BulkMessageAction, direction: "inbound" | "outbound") {
	if (action === "trash") return "/trash";
	if (action === "spam") return "/spam";
	if (action === "archive") return direction === "inbound" ? "/inbox" : "/sent";
	return null;
}
