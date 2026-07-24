export type ComposeDraft = {
	id: string;
	mailboxId: string | null;
	fromAddr: string;
	toAddr: string;
	subject: string | null;
	textBody: string | null;
	htmlBody: string | null;
	replySourceMessageId: string | null;
};

export type DraftResponse = {
	draft?: ComposeDraft;
	error?: string;
};
