import type { Message } from "@/hooks/types";
import { authFetch } from "@/lib/auth/client";
import { getEmailDisplayName } from "@/lib/email/address";
import type { MessageFolderConfig } from "./types";
import type { PageRange } from "./types";

export function getMessageParty(message: Message, folder: MessageFolderConfig["folder"]) {
	if (folder === "drafts") return "Draft";
	if (folder === "sent") return message.toContactName ?? (message.toAddr ? getEmailDisplayName(message.toAddr) : "No recipient");
	return message.fromContactName ?? (message.fromAddr ? getEmailDisplayName(message.fromAddr) : "Unknown sender");
}

export function getMessagePartyClassName(message: Message, folder: MessageFolderConfig["folder"]) {
	if (folder === "drafts") return "truncate font-semibold text-danger";

	const unread = message.direction === "inbound" && !message.read;
	return `truncate ${unread ? "font-bold text-ink" : "text-ink"}`;
}

export function getMessagePreview(message: Message, folder: MessageFolderConfig["folder"]) {
	if (folder === "drafts") return message.snippet || message.toAddr || "No content";
	return message.snippet || "No preview";
}

export function getMessageBadge(message: Message, folder: MessageFolderConfig["folder"]) {
	if (folder === "drafts") return "draft";
	if (folder === "trash" || folder === "spam") return message.status;
	return message.direction;
}

export function getPageRange(offset: number, count: number, total: number): PageRange {
	if (total === 0 || count === 0) return { start: 0, end: 0, total };

	return {
		start: offset + 1,
		end: Math.min(offset + count, total),
		total,
	};
}

export async function runBulkMessageAction(messageIds: string[], action: string) {
	const response = await authFetch("/api/messages/bulk", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ messageIds, action }),
	});

	if (!response.ok) throw new Error("Unable to update selected messages");
	window.dispatchEvent(new Event("lumimail:messages-changed"));
}
