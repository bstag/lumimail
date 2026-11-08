import { apiJson } from "@/lib/api/client-response";
import type { Message } from "@/hooks/types";
import type { ViewQuery } from "./bulk-cleanup-utils";

export const GROUP_BY_SENDER_KEY = "picket:inbox-group-by-sender";
const GROUP_BY_SENDER_EVENT = "picket:inbox-group-by-sender-change";
export const SENDER_PAGE = 25;
/** Matches the senders endpoint's maximum page. */
export const MAX_SENDERS = 500;
export const SENDER_PREVIEW = 10;

export type SenderGroup = {
	sender: string;
	fromAddr: string;
	count: number;
	unread: number;
	latestId: string;
	latestSubject: string | null;
	latestAt: string;
};

// This tab's latest choice, so the toggle works even where storage is unavailable.
let sessionChoice: boolean | null = null;

/** Whether the Inbox is grouped by sender on this device (F103); off by default. */
export function readGroupBySender(): boolean {
	if (sessionChoice !== null) return sessionChoice;
	try {
		return globalThis.localStorage.getItem(GROUP_BY_SENDER_KEY) === "1";
	} catch {
		return false;
	}
}

export function writeGroupBySender(next: boolean) {
	sessionChoice = next;
	try {
		globalThis.localStorage.setItem(GROUP_BY_SENDER_KEY, next ? "1" : "0");
	} catch {
		// Storage can be unavailable; the event below still updates this tab.
	}
	globalThis.dispatchEvent(new Event(GROUP_BY_SENDER_EVENT));
}

export function subscribeGroupBySender(onChange: () => void) {
	const onStorage = (event: StorageEvent) => {
		if (event.key !== GROUP_BY_SENDER_KEY) return;
		sessionChoice = null;
		onChange();
	};
	globalThis.addEventListener(GROUP_BY_SENDER_EVENT, onChange);
	globalThis.addEventListener("storage", onStorage);
	return () => {
		globalThis.removeEventListener(GROUP_BY_SENDER_EVENT, onChange);
		globalThis.removeEventListener("storage", onStorage);
	};
}

export function withSender(view: ViewQuery, sender: string): ViewQuery {
	return { ...view, sender };
}

export async function fetchSenderGroups(view: ViewQuery, limit: number) {
	const params = new URLSearchParams({ ...view, limit: String(limit) });
	return apiJson.get<{ total: number; senders: SenderGroup[] }>(`/api/messages/senders?${params}`);
}

/** The newest messages from one sender in the view, for an expanded group. */
export async function fetchSenderMessages(view: ViewQuery, sender: string): Promise<Message[]> {
	const params = new URLSearchParams({ ...withSender(view, sender), limit: String(SENDER_PREVIEW) });
	return (await apiJson.get<{ messages: Message[] }>(`/api/messages?${params}`)).messages;
}
