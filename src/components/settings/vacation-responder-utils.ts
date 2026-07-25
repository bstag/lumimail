export const DEFAULT_RESPONDER = {
	subject: "Out of office",
	body: "I am currently out of office and will reply when I return.",
};

/**
 * Picks the responder belonging to one mailbox. Returns null when that mailbox has
 * none, which the form renders as the unconfigured defaults rather than as another
 * mailbox's settings (F65).
 */
export function findResponderForMailbox<T extends { mailboxId: string }>(
	responders: T[],
	mailboxId: string,
): T | null {
	return responders.find((responder) => responder.mailboxId === mailboxId) ?? null;
}
