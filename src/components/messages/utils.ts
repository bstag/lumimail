import type { QueryClient } from "@tanstack/react-query";
import type { Message } from "@/hooks/types";
import { invalidateMessageQueries } from "@/lib/query-keys";
import { authFetch } from "@/lib/auth/client";
import { getEmailAddress, getEmailDisplayName } from "@/lib/email/address";
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
	if (folder === "sent") return message.status;
	if (folder === "trash" || folder === "spam") return message.status;
	return message.direction;
}

export type ExternalSourceAccount = {
	id: string;
	mailboxId: string;
	provider: "google" | "microsoft";
	externalAddress: string;
};

function findExternalSource(
	message: Message,
	accounts: readonly ExternalSourceAccount[],
): ExternalSourceAccount | undefined {
	const from = getEmailAddress(message.fromAddr).toLowerCase();
	const to = getEmailAddress(message.toAddr).toLowerCase();
	return accounts.find((candidate) => candidate.mailboxId === message.mailboxId && (
		candidate.externalAddress.toLowerCase() === from || candidate.externalAddress.toLowerCase() === to
	));
}

export function getExternalSourceLabel(
	message: Message,
	accounts: readonly ExternalSourceAccount[],
): string | null {
	const account = findExternalSource(message, accounts);
	return account
		? `${account.provider === "google" ? "Google" : "Microsoft"} · ${account.externalAddress}`
		: null;
}

/**
 * Compact source for list rows: the provider's mail product, with the full label kept for a
 * tooltip. The full "Google · address" badge was wider than the subject on narrow layouts.
 */
export function getExternalSourceBadge(
	message: Message,
	accounts: readonly ExternalSourceAccount[],
): { short: string; full: string } | null {
	const account = findExternalSource(message, accounts);
	if (!account) return null;
	return {
		short: account.provider === "google" ? "Gmail" : "Outlook",
		full: `${account.provider === "google" ? "Google" : "Microsoft"} · ${account.externalAddress}`,
	};
}

export function getPageRange(offset: number, count: number, total: number): PageRange {
	if (total === 0 || count === 0) return { start: 0, end: 0, total };

	return {
		start: offset + 1,
		end: Math.min(offset + count, total),
		total,
	};
}

export async function retryMessageDelivery(queryClient: QueryClient, messageId: string) {
	const response = await authFetch(`/api/messages/${messageId}/retry`, { method: "POST" });

	if (!response.ok) throw new Error("Unable to retry delivery");
	void invalidateMessageQueries(queryClient);
}

export async function runBulkMessageAction(
	queryClient: QueryClient,
	messageIds: string[],
	action: string,
) {
	const response = await authFetch("/api/messages/bulk", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ messageIds, action }),
	});

	if (!response.ok) throw new Error("Unable to update selected messages");
	void invalidateMessageQueries(queryClient);
}
