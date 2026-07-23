import type { OutboundMessage, OutboundProvider, OutboundSendResult } from "./types";

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
			const result = await env.EMAIL.send({
				from: message.from,
				to: message.to,
				subject: message.subject,
				html: message.html,
				text: message.text,
			});
			return { providerMessageId: result.messageId };
		},
	};
}
