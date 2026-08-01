import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { MessageDirection } from "@/hooks/types";

export type MessageActionsProps = {
	messageId: string;
	direction: MessageDirection;
	status: string;
	read: boolean;
	fromAddr?: string;
	toAddr?: string;
	subject?: string | null;
	/**
	 * The mailbox that received (or sent) this message. A reply sends from it
	 * rather than from whatever mailbox is globally active — in all-mailboxes
	 * scope (F76) those differ, and replying to shared-mailbox mail under the
	 * individual's own address would be the wrong sender.
	 */
	mailboxId?: string | null;
	canSend?: boolean;
	onActionSuccess?: (action: BulkMessageAction) => void;
};

export type SingleMessageAction = BulkMessageAction | "reply";
