import type { OutboundMessage, OutboundProvider, OutboundSendResult } from "./types";

/**
 * Cloudflare Email Sending provider (default).
 *
 * Wraps the `env.EMAIL` (`SendEmail`) binding. Note that Cloudflare only
 * delivers to verified destination addresses; for arbitrary recipients use a
 * dedicated provider such as Resend (`MAIL_PROVIDER=resend`).
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
