/**
 * Single source for enums and limits shared between the Drizzle schema, the Zod
 * validators, and the email pipeline. Lives outside both `src/db/schema` and
 * `src/lib/validators.ts` so neither has to import the other.
 */

export const MAILBOX_ROLES = ["viewer", "responder", "manager"] as const;
export type MailboxRole = (typeof MAILBOX_ROLES)[number];

/** Mailbox roles allowed to send as the mailbox address. */
export const SENDER_ROLES = ["responder", "manager"] as const satisfies readonly MailboxRole[];

export const ORG_INVITE_ROLES = ["admin", "member"] as const;
export type OrgInviteRole = (typeof ORG_INVITE_ROLES)[number];

export const ROUTING_ACTIONS = ["store", "forward", "reject"] as const;
export type RoutingAction = (typeof ROUTING_ACTIONS)[number];

export const DEFAULT_LABEL_COLOR = "#6366f1";

/** Registrable DNS hostname: dotted labels, 63-char label cap, alphabetic TLD. */
export const DOMAIN_HOSTNAME_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

/** Queue redelivery delay for transient outbound/inbound processing failures. */
export const RETRY_DELAY_SECONDS = 30;

/**
 * Cap on error text persisted to job/delivery rows. Stored diagnostics only;
 * webhook payloads and thrown errors are not truncated by this.
 */
export const MAX_STORED_ERROR_LENGTH = 500;

/**
 * Every value the application writes to `messages.status`.
 *
 * The tuple is deliberately typed wide (`[string, ...string[]]`) so the Drizzle
 * column keeps a `string` data type: `updateMessageStatus` (src/lib/user.ts) and
 * the messages/bulk routes pass runtime-validated plain strings today, and those
 * call sites belong to a later refactoring wave. Narrow this to `as const` when
 * they are migrated.
 */
export const MESSAGE_STATUSES: [string, ...string[]] = [
	"received",
	"queued",
	"sent",
	"failed",
	"draft",
	"trash",
	"spam",
	"archived",
];

export const WEBHOOK_DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];
