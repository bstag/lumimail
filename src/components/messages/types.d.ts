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
	/** Provider identity for mail imported through an external account. */
	externalSourceLabel?: string;
	/**
	 * Two-line row: sender + meta on one line, subject on the next. Decided by a
	 * media query in the parent and passed down, so 25 rows share one listener.
	 */
	compact?: boolean;
	/** Pre-formatted row timestamp; the parent formats all rows against one instant. */
	timestamp?: string;
	/** Opens the selected message in the desktop panel while retaining the full-page mobile href. */
	href?: string;
	/** Visual/current-row state for the open desktop conversation. */
	active?: boolean;
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
