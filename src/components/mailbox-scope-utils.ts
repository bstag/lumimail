import type { MailboxOption } from "./mailbox-provider";

/**
 * All-mailboxes scope (F76).
 *
 * The scope is deliberately *separate state* from the active mailbox rather than
 * being "no mailbox selected". Two reasons:
 *
 * 1. `null` already means "not resolved yet" in `MailboxProvider`, and its effect
 *    replaces a null selection with the primary mailbox on every mailbox-list
 *    load — a scope expressed as null could not survive a refetch.
 * 2. The composer sets the active mailbox as a side effect (loading a draft, or
 *    picking a send-capable mailbox). If the scope were the same value, opening
 *    the composer would silently drop the user out of All mailboxes.
 *
 * So the active mailbox keeps meaning "the identity I send as", and the scope
 * only decides whether message *lists* are filtered by it.
 */

/** The stored value meaning "all". Anything else reads as a normal scope. */
const ALL_SCOPE_FLAG = "1";

/**
 * The mailbox id a list query should filter by, or null for no filter.
 *
 * Null is not "no authorization" — `/api/messages` falls back to
 * `messageAccessCondition`, which is the same predicate a scoped query applies
 * on top of the mailbox filter. Dropping the filter removes a narrowing
 * condition, never the authorization one.
 */
export function resolveScopedMailboxId(
	allMailboxes: boolean,
	selectedMailboxId?: string | null,
): string | null {
	if (allMailboxes) return null;
	return selectedMailboxId ?? null;
}

/** With one mailbox the option would be a no-op, so it is not offered. */
export function isAllScopeAvailable(mailboxCount: number): boolean {
	return mailboxCount > 1;
}

/**
 * Whether a persisted scope should be honored. A user who has dropped to a
 * single mailbox must not stay in a scope the selector no longer offers.
 */
export function readStoredAllScope(stored: string | null, mailboxCount: number): boolean {
	return stored === ALL_SCOPE_FLAG && isAllScopeAvailable(mailboxCount);
}

export const ALL_SCOPE_STORED_VALUE = ALL_SCOPE_FLAG;

/**
 * The mailbox a reply should send from: the one that received the message.
 *
 * Returns null when the message carries no mailbox, or names one the caller can
 * no longer read — the caller then falls back to the active mailbox. Verifying
 * membership here matters because a stale `mailboxId` would otherwise seed the
 * composer with an identity the server will refuse.
 */
export function resolveReplyMailboxId(
	message: { mailboxId: string | null },
	mailboxes: MailboxOption[],
): string | null {
	if (!message.mailboxId) return null;
	return mailboxes.some((mailbox) => mailbox.id === message.mailboxId)
		? message.mailboxId
		: null;
}
