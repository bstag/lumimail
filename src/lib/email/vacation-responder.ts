import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { vacationReplyLog, vacationResponders } from "@/db/schema";
import { newId } from "@/lib/ids";
import { sendEmail } from "@/lib/email/outbound/submit";
import {
	isVacationAudienceAllowed,
	normalizeVacationAddress,
	shouldSuppressVacationReply,
	withinVacationReplyWindow,
} from "@/lib/email/vacation";

export type VacationRespondInput = {
	userId: string;
	fromAddr: string;
	toAddr: string;
	subject: string | undefined;
	headers: Record<string, string>;
	organizationId: string | null;
	mailboxId: string;
};

/**
 * Sends the mailbox's out-of-office reply for an inbound message when the
 * responder is enabled, the sender is eligible, and no reply was sent inside
 * the per-correspondent window. Extracted from the inbound consumer (T-32) so
 * `sendEmail` can be imported statically instead of via the previous dynamic
 * import that papered over the inbound↔send module cycle.
 */
export async function maybeVacationRespond(
	env: CloudflareEnv,
	input: VacationRespondInput,
): Promise<void> {
	const { userId, fromAddr, toAddr, subject, headers, organizationId, mailboxId } = input;
	// Header- and sender-based suppression comes first: it decides whether this
	// message may be answered at all, before any per-correspondent bookkeeping.
	const suppression = shouldSuppressVacationReply({ fromAddr, toAddr, headers });
	if (suppression) return;

	const db = getDb(env);
	const [responder] = await db
		.select()
		.from(vacationResponders)
		.where(eq(vacationResponders.mailboxId, mailboxId))
		.limit(1);

	if (!responder?.enabled) return;

	const now = new Date();
	if (responder.startDate && now < responder.startDate) return;
	if (responder.endDate && now > responder.endDate) return;

	const audienceAllowed = await isVacationAudienceAllowed(db, {
		userId,
		organizationId,
		fromAddr,
		responder,
	});
	if (!audienceAllowed) return;

	if (await withinVacationReplyWindow(db, mailboxId, fromAddr, now)) return;

	try {
		await sendEmail(env, {
			userId,
			from: toAddr,
			to: fromAddr,
			subject: `Re: ${subject ?? ""} — ${responder.subject}`,
			text: responder.body,
			autoReply: true,
		});
	} catch {
		// vacation reply is best-effort
		return;
	}

	// Recorded only after a successful send, so a failed reply does not consume the
	// correspondent's window. A failure here means one possible duplicate later,
	// which is preferable to failing inbound delivery.
	try {
		await db
			.insert(vacationReplyLog)
			.values({
				id: newId("vrl"),
				mailboxId,
				senderAddress: normalizeVacationAddress(fromAddr),
				lastRepliedAt: now,
			})
			.onConflictDoUpdate({
				target: [vacationReplyLog.mailboxId, vacationReplyLog.senderAddress],
				set: { lastRepliedAt: now },
			});
	} catch {
		console.warn("Vacation reply log could not be updated");
	}
}
