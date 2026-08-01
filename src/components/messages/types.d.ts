import type { Message, MessageFolder } from "@/hooks/types";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";

export type MessageFolderConfig = {
	folder: MessageFolder;
	emptyText: string;
	hrefPrefix: string;
	badgeVariant?: "default" | "secondary" | "outline";
	showRowBadge?: boolean;
	/** Set for a label view (F75); pins the list to one label. */
	labelId?: string;
	/** Heading shown above the list. Label views name the label. */
	title?: string;
};

export type MessageListRowProps = {
	message: Message;
	config: MessageFolderConfig;
	selected: boolean;
	onSelectedChange: (messageId: string, selected: boolean) => void;
	onStarToggle: (messageId: string, starred: boolean) => void;
	canSend?: boolean;
	/**
	 * Which mailbox the row belongs to. Set only in all-mailboxes scope (F76) —
	 * with a single mailbox selected it would repeat the same value on every row.
	 */
	mailboxLabel?: string;
};

export type BulkMessageToolbarProps = {
	selectedCount: number;
	hasUnreadSelection: boolean;
	onAction: (action: BulkMessageAction) => void;
	onClearSelection: () => void;
	pending: boolean;
};

export type PageRange = {
	start: number;
	end: number;
	total: number;
};
