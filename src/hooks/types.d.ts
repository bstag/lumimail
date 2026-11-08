export type MessageStatus =
	| "received"
	| "sent"
	| "draft"
	| "queued"
	| "failed"
	| "trash"
	| "spam"
	| "archived";

export type MessageFolder =
	| "inbox"
	| "sent"
	| "drafts"
	| "archived"
	| "trash"
	| "spam"
	| "starred"
	// Received mail whose snooze has not ended (F100).
	| "snoozed"
	// A label view (F75). Not a status: it constrains `labelId` alone, so it
	// spans every status and both directions.
	| "label";

export type MessageDirection = "inbound" | "outbound";

export type Message = {
	id: string;
	userId: string;
	mailboxId: string | null;
	direction: MessageDirection;
	providerMessageId: string | null;
	fromAddr: string;
	toAddr: string;
	fromContactName?: string | null;
	toContactName?: string | null;
	subject: string | null;
	snippet: string | null;
	status: MessageStatus | string;
	read: boolean;
	starred: boolean;
	/** ISO time; in the future while the message is snoozed (F100). */
	snoozedUntil?: string | null;
	threadId: string | null;
	threadCount?: number;
	createdAt: string;
};

export type MessageReadFilter = "all" | "read" | "unread";

export type MessageFilterOptions = {
	query?: string;
	read?: MessageReadFilter;
	title?: string;
	limit?: number;
	offset?: number;
	labelId?: string;
	/** Inbox only: Focused / Other split (F97). */
	focus?: "focused" | "other";
};

export type MessageListResponse = {
	messages?: Message[];
	total?: number;
	limit?: number;
	offset?: number;
};

export type FolderCount = {
	total: number;
	unread: number;
};

export type MailboxCount = {
	mailboxId: string;
	total: number;
	unread: number;
	inbox: number;
};

/**
 * The folders that have a count. A label view is a filter over other folders'
 * mail rather than a place mail lives, so it has no bucket of its own — keeping
 * it out of the record is what stops every counts literal from having to invent
 * a meaningless `label: { total: 0 }`.
 */
export type CountedFolder = Exclude<MessageFolder, "label" | "snoozed">;

export type MessageCounts = {
	folders: Record<CountedFolder, FolderCount>;
	mailboxes: MailboxCount[];
};
