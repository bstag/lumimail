import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { contacts, domains, vacationReplyLog } from "@/db/schema";

/**
 * One auto-reply per correspondent per this many days. Long enough that a loop
 * cannot become a storm, short enough that a genuine ongoing exchange is
 * re-informed that the recipient is away.
 */
export const VACATION_REPLY_WINDOW_DAYS = 4;

const WINDOW_MS = VACATION_REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Headers every Lumimail auto-reply carries.
 *
 * `Auto-Submitted: auto-replied` is the RFC 3834 marker. It is what makes two
 * enabled responders terminate instead of answering each other forever, because
 * our own suppression rules recognise it on the way back in.
 */
export const AUTO_REPLY_HEADERS: Record<string, string> = {
	"Auto-Submitted": "auto-replied",
	"X-Auto-Response-Suppress": "All",
};

export type VacationSuppressionReason =
	| "null_sender"
	| "auto_submitted"
	| "bulk_precedence"
	| "mailing_list"
	| "suppress_requested"
	| "automated_sender"
	| "self";

const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

/** Local-parts that belong to machinery rather than a person. */
const AUTOMATED_LOCAL_PARTS = [
	"noreply",
	"no-reply",
	"mailer-daemon",
	"postmaster",
	"bounce",
	"bounces",
];

function headerValue(headers: Record<string, string>, name: string): string | null {
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === wanted) return value.trim().toLowerCase();
	}
	return null;
}

function hasListHeader(headers: Record<string, string>): boolean {
	return Object.keys(headers).some((key) => key.toLowerCase().startsWith("list-"));
}

function normalizeAddress(address: string): string {
	return address.trim().toLowerCase().replace(/^<|>$/g, "");
}

/**
 * Decides whether an inbound message must not receive an auto-reply, returning the
 * reason so callers can log a category without recording the correspondent.
 */
export function shouldSuppressVacationReply(input: {
	fromAddr: string;
	toAddr: string;
	headers: Record<string, string>;
}): VacationSuppressionReason | null {
	const from = normalizeAddress(input.fromAddr);
	// An empty envelope sender marks a bounce. Replying generates another bounce.
	if (!from) return "null_sender";

	const autoSubmitted = headerValue(input.headers, "auto-submitted");
	// RFC 3834: "no" affirms the message is not automatic; anything else is.
	if (autoSubmitted && autoSubmitted !== "no") return "auto_submitted";

	const precedence = headerValue(input.headers, "precedence");
	if (precedence && BULK_PRECEDENCE.has(precedence)) return "bulk_precedence";

	// A reply to a list can reach every subscriber, so any List- header is enough.
	if (hasListHeader(input.headers)) return "mailing_list";

	if (headerValue(input.headers, "x-auto-response-suppress")) return "suppress_requested";

	// `from` is non-empty by the null-sender check above, so split always yields a
	// first element; no fallback is reachable here.
	const localPart = from.split("@")[0];
	if (AUTOMATED_LOCAL_PARTS.some((candidate) => localPart.startsWith(candidate))) {
		return "automated_sender";
	}

	if (from === normalizeAddress(input.toAddr)) return "self";

	return null;
}

/**
 * True when this correspondent has already been told, within the window, that the
 * recipient is away.
 */
export async function withinVacationReplyWindow(
	db: AppDatabase,
	userId: string,
	senderAddress: string,
	now: Date,
): Promise<boolean> {
	const sender = normalizeAddress(senderAddress);
	const [entry] = await db
		.select({ lastRepliedAt: vacationReplyLog.lastRepliedAt })
		.from(vacationReplyLog)
		.where(and(
			eq(vacationReplyLog.userId, userId),
			eq(vacationReplyLog.senderAddress, sender),
		))
		.limit(1);

	if (!entry?.lastRepliedAt) return false;
	return now.getTime() - entry.lastRepliedAt.getTime() < WINDOW_MS;
}

export type VacationAudience = {
	replyToContacts: boolean;
	replyToOrganization: boolean;
};

/**
 * Applies the responder's audience restrictions.
 *
 * The two flags are independent and combine as OR, so "people I know plus my
 * colleagues" is expressible. With neither set the responder answers everyone,
 * which is the pre-existing behaviour and the default for existing rows.
 *
 * "Organization" means any domain belonging to the owner's organization rather
 * than only the receiving mailbox's domain, so a colleague on a second company
 * domain is treated as internal.
 */
export async function isVacationAudienceAllowed(
	db: AppDatabase,
	input: {
		userId: string;
		organizationId: string | null;
		fromAddr: string;
		responder: VacationAudience;
	},
): Promise<boolean> {
	const { replyToContacts, replyToOrganization } = input.responder;
	if (!replyToContacts && !replyToOrganization) return true;

	const sender = normalizeAddress(input.fromAddr);

	if (replyToContacts) {
		const [contact] = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.userId, input.userId), eq(contacts.email, sender)))
			.limit(1);
		if (contact) return true;
	}

	if (replyToOrganization && input.organizationId) {
		const domain = sender.split("@")[1];
		// A sender with no domain part cannot belong to an organization domain.
		if (domain) {
			const [match] = await db
				.select({ id: domains.id })
				.from(domains)
				.where(and(
					eq(domains.organizationId, input.organizationId),
					eq(domains.hostname, domain),
				))
				.limit(1);
			if (match) return true;
		}
	}

	return false;
}

export { normalizeAddress as normalizeVacationAddress };
