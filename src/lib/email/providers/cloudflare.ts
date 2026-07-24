import {
	OutboundProviderError,
	type OutboundMessage,
	type OutboundProvider,
	type OutboundSendResult,
} from "./types";

const RETRYABLE_CODES = new Set([
	"E_RATE_LIMIT_EXCEEDED",
	"E_DELIVERY_FAILED",
	"E_INTERNAL_SERVER_ERROR",
]);

function cloudflareErrorDetails(error: unknown): { message: string; code?: string } {
	if (!(error instanceof Error)) return { message: "Cloudflare email send failed" };
	const code =
		typeof (error as Error & { code?: unknown }).code === "string"
			? (error as Error & { code: string }).code
			: undefined;
	return { message: error.message || "Cloudflare email send failed", code };
}

/**
 * Cloudflare Email Sending provider (default).
 *
 * Wraps the `env.EMAIL` (`SendEmail`) binding. On Workers Paid, an onboarded
 * Email Sending domain can send transactional mail to arbitrary recipients.
 * Verified destination addresses remain available without full sending-domain
 * onboarding under Cloudflare's separate free-path rules.
 */
export function createCloudflareProvider(env: CloudflareEnv): OutboundProvider {
	return {
		id: "cloudflare",
		async send(message: OutboundMessage): Promise<OutboundSendResult> {
			try {
				const result = await env.EMAIL.send({
					from: message.from,
					to: message.to,
					subject: message.subject,
					html: message.html,
					text: message.text,
				});
				return { providerMessageId: result.messageId };
			} catch (error) {
				const details = cloudflareErrorDetails(error);
				throw new OutboundProviderError(details.message, {
					code: details.code,
					retryable: details.code ? RETRYABLE_CODES.has(details.code) : false,
					cause: error,
				});
			}
		},
	};
}
