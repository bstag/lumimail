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
	/** Mailboxes the signed-in user can access (`/api/mailboxes`). */
	user: ["mailboxes"] as const,
	/** Every organization mailbox, admin-scoped (`/api/admin/mailboxes`). */
	admin: ["admin", "mailboxes"] as const,
};

export const labelKeys = {
	all: ["labels"] as const,
};
