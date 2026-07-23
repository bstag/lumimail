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
	canSend?: boolean;
};

export type SingleMessageAction = BulkMessageAction | "reply";
