/**
 * Central TanStack Query key registry for keys shared across files.
 *
 * Keys are hierarchical: invalidating a prefix (e.g. `domainKeys.all`) also
 * invalidates every variant beneath it. Two queries may share an exact key
 * only if they fetch the same payload shape — the domains list with and
 * without DNS detail previously shared a bare ["domains"] key, so navigating
 * between pages served the wrong cached shape (T-03 in
 * docs/TECH_DEBT_PLAN.md).
 *
 * Keys used by a single file may stay local to that file; register a key here
 * as soon as a second file needs it.
 */
export const domainKeys = {
	all: ["domains"] as const,
	list: (options: { includeDns: boolean }) => ["domains", options] as const,
};

export const mailboxKeys = {
	/**
	 * Mailboxes the signed-in user can access — the raw `{ mailboxes }`
	 * envelope from `/api/mailboxes` (admin pages).
	 */
	user: ["mailboxes"] as const,
	/**
	 * The same endpoint mapped to `MailboxOption[]` for the mailbox provider
	 * and selector. A distinct key from `user` because the cached payload
	 * shapes differ (the T-03 hazard); it stays under the `["mailboxes"]`
	 * prefix so invalidating `mailboxKeys.user` refreshes both.
	 */
	options: ["mailboxes", "options"] as const,
	/** Every organization mailbox, admin-scoped (`/api/admin/mailboxes`). */
	admin: ["admin", "mailboxes"] as const,
};

export const labelKeys = {
	all: ["labels"] as const,
};

export type MessageListKeyOptions = {
	mailboxId: string | null;
	query: string | null;
	read: string | null;
	title: string | null;
	limit: number | null;
	offset: number | null;
	labelId: string | null;
};

/**
 * Every message-derived query lives under the `["messages"]` prefix so one
 * `invalidateMessageQueries` call refreshes lists, counts, the open detail
 * page, and any loaded thread after a mutation — the TanStack replacement for
 * the retired `notifyMessagesChanged` window event (T-34).
 */
export const messageKeys = {
	all: ["messages"] as const,
	list: (folder: string, options: MessageListKeyOptions) =>
		["messages", "list", folder, options] as const,
	counts: (mailboxId: string | null) => ["messages", "counts", mailboxId] as const,
	detail: (messageId: string) => ["messages", "detail", messageId] as const,
	thread: (threadId: string) => ["messages", "thread", threadId] as const,
};

type MessageInvalidationClient = {
	invalidateQueries: (filters: { queryKey: typeof messageKeys.all }) => Promise<void>;
};

/**
 * Invalidates every message-derived query (folder lists, counts, message
 * detail, threads). Call after any mutation that changes message state.
 */
export function invalidateMessageQueries(queryClient: MessageInvalidationClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: messageKeys.all });
}
