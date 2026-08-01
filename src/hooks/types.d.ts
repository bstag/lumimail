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
	threadId: string | null;
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
export type CountedFolder = Exclude<MessageFolder, "label">;

export type MessageCounts = {
	folders: Record<CountedFolder, FolderCount>;
	mailboxes: MailboxCount[];
};
