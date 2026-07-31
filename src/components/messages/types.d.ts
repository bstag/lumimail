import type { LucideIcon } from "lucide-react";
import type { Message, MessageFolder } from "@/hooks/types";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";

export type MessageFolderConfig = {
	folder: MessageFolder;
	emptyText: string;
	hrefPrefix: string;
	icon: LucideIcon;
	badgeVariant?: "default" | "secondary" | "outline";
	showRowBadge?: boolean;
};

export type MessageListRowProps = {
	message: Message;
	config: MessageFolderConfig;
	selected: boolean;
	onSelectedChange: (messageId: string, selected: boolean) => void;
	onStarToggle: (messageId: string, starred: boolean) => void;
	canSend?: boolean;
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
