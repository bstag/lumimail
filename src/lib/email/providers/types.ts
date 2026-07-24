/**
 * Outbound mail provider abstraction.
 *
 * Lumimail's outbound path was hard-wired to the Cloudflare `send_email`
 * binding (`env.EMAIL`). That binding can only deliver to destination
 * addresses verified in the account, which is unsuitable for general
 * transactional mail. This abstraction lets an operator select a provider via
 * `MAIL_PROVIDER` while keeping Cloudflare as the default (non-breaking).
 *
 * Providers are intentionally thin: they translate a normalized
 * `OutboundMessage` into a single send call and return a normalized
 * `OutboundSendResult`. All persistence, validation, and webhook dispatch stay
 * in `src/lib/email/send.ts`.
 */

/** A normalized, provider-agnostic outbound message. */
export type OutboundMessage = {
	from: string;
	to: string;
	subject: string;
	html?: string;
	text?: string;
};

/** Normalized result of a successful send. */
export type OutboundSendResult = {
	/** Provider-assigned message id, stored as `messages.providerMessageId`. */
	providerMessageId: string;
};

export class OutboundProviderError extends Error {
	readonly retryable: boolean;
	readonly code?: string;

	constructor(
		message: string,
		options: { retryable: boolean; code?: string; cause?: unknown },
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "OutboundProviderError";
		this.retryable = options.retryable;
		this.code = options.code;
	}
}

/** A configured outbound provider ready to send a single message. */
export interface OutboundProvider {
	/** Stable provider identifier, e.g. `"cloudflare"` or `"resend"`. */
	readonly id: string;
	send(message: OutboundMessage): Promise<OutboundSendResult>;
}
