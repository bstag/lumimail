import { useEffect, useState } from "react";
import type { Message, MessageFilterOptions, MessageFolder } from "./types";
import { clearMessageCountsCache, clearMessageListCache, fetchMessageList, getMessageQueryParams } from "./utils";
import {
	shouldRefreshDeliveryStatus,
	shouldRefreshSharedDrafts,
} from "@/components/messages/message-folder-utils";

export function useMessages(
	folder: MessageFolder,
	mailboxId?: string | null,
	filters?: MessageFilterOptions,
	enabled = true,
) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [total, setTotal] = useState(0);
	const [limit, setLimit] = useState(filters?.limit ?? 25);
	const [offset, setOffset] = useState(filters?.offset ?? 0);
	const {
		labelId,
		limit: requestedLimit,
		offset: requestedOffset,
		query,
		read,
		title,
	} = filters ?? {};

	const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.read).length;

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		let currentStatuses: string[] = [];
		async function loadMessages(force = false, background = false) {
			if (!background) setIsLoading(true);
			try {
				const params = getMessageQueryParams(folder, mailboxId, {
					labelId,
					limit: requestedLimit,
					offset: requestedOffset,
					query,
					read,
					title,
				});
				const data = await fetchMessageList(params, force);
				currentStatuses = (data.messages ?? []).map((message) => message.status);
				if (!cancelled) {
					setMessages(data.messages ?? []);
					setTotal(data.total ?? 0);
					setLimit(data.limit ?? requestedLimit ?? 25);
					setOffset(data.offset ?? requestedOffset ?? 0);
				}
			} catch (err) {
				if (!cancelled) {
					setMessages([]);
					setTotal(0);
					if (process.env.NODE_ENV !== "production") {
						console.error("Failed to load messages", err);
					}
				}
			} finally {
				if (!cancelled && !background) setIsLoading(false);
			}
		}

		void loadMessages();
		function onMessagesChanged() {
			clearMessageListCache();
			clearMessageCountsCache();
			void loadMessages(true);
		}
		window.addEventListener("lumimail:messages-changed", onMessagesChanged);
		function refreshSharedDrafts() {
			if (shouldRefreshSharedDrafts(folder, document.visibilityState)) {
				void loadMessages(true, true);
			}
		}
		function refreshDeliveryStatus() {
			if (shouldRefreshDeliveryStatus(folder, document.visibilityState, currentStatuses)) {
				void loadMessages(true, true);
			}
		}
		const refreshInterval = folder === "drafts"
			? window.setInterval(refreshSharedDrafts, 10_000)
			: folder === "sent"
				? window.setInterval(refreshDeliveryStatus, 5_000)
				: null;
		window.addEventListener("focus", refreshSharedDrafts);
		window.addEventListener("focus", refreshDeliveryStatus);
		document.addEventListener("visibilitychange", refreshSharedDrafts);
		document.addEventListener("visibilitychange", refreshDeliveryStatus);

		return () => {
			cancelled = true;
			window.removeEventListener("lumimail:messages-changed", onMessagesChanged);
			window.removeEventListener("focus", refreshSharedDrafts);
			window.removeEventListener("focus", refreshDeliveryStatus);
			document.removeEventListener("visibilitychange", refreshSharedDrafts);
			document.removeEventListener("visibilitychange", refreshDeliveryStatus);
			if (refreshInterval !== null) window.clearInterval(refreshInterval);
		};
	}, [enabled, folder, labelId, mailboxId, query, read, requestedLimit, requestedOffset, title]);

	return { messages, setMessages, unreadCount, isLoading, total, limit, offset };
}
