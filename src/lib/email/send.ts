/**
 * Compatibility barrel for the outbound delivery pipeline (T-30).
 *
 * The implementation lives in `src/lib/email/outbound/`:
 * - `authorization.ts` — pure-DB sender authorization
 * - `snapshot.ts` — the immutable producer/consumer payload contract
 * - `submit.ts` — the producer (`sendEmail`)
 * - `consumer.ts` — the queue consumer and dead-letter handler
 * - `recovery.ts` — operator recovery for failed jobs
 *
 * Existing importers (worker entry, API routes, tests) continue to work
 * through this module; new code should import from the split modules.
 */
export {
	resolveSenderAuthorization,
	SenderNotAllowedError,
	validateSenderDomain,
	type SenderAuthorization,
} from "@/lib/email/outbound/authorization";
export {
	parseDeliverySnapshot,
	type OutboundAttachmentSnapshot,
	type OutboundDeliverySnapshot,
	type OutboundQueueMessage,
} from "@/lib/email/outbound/snapshot";
export {
	sendEmail,
	ReplySourceNotAllowedError,
	type SendEmailInput,
} from "@/lib/email/outbound/submit";
export {
	processOutboundDeadLetter,
	processOutboundQueue,
	type OutboundQueueResult,
} from "@/lib/email/outbound/consumer";
export {
	recoverOutboundJob,
	type OutboundRecoveryResult,
} from "@/lib/email/outbound/recovery";
