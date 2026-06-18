import type { OutboundMessage, OutboundProvider, OutboundSendResult } from "./types";

const DEFAULT_BASE_URL = "https://api.resend.com";

type ResendSuccess = { id?: string };

/**
 * Resend provider (`MAIL_PROVIDER=resend`).
 *
 * Sends via the Resend HTTP API, which delivers to arbitrary recipients on a
 * verified sending domain — unlike the Cloudflare binding. Requires
 * `RESEND_API_KEY`; `RESEND_BASE_URL` may override the endpoint (self-hosted
 * proxy or tests).
 *
 * The `from` address must belong to a domain verified in Resend. Sender
 * authorization against the user's own mailboxes is enforced upstream in
 * `sendEmail()`, so this provider does not re-check it.
 */
export function createResendProvider(env: CloudflareEnv): OutboundProvider {
	const apiKey = env.RESEND_API_KEY;
	if (!apiKey) {
		throw new Error("RESEND_API_KEY is required when MAIL_PROVIDER=resend");
	}
	const baseUrl = (env.RESEND_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

	return {
		id: "resend",
		async send(message: OutboundMessage): Promise<OutboundSendResult> {
			const response = await fetch(`${baseUrl}/emails`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					from: message.from,
					to: [message.to],
					subject: message.subject,
					html: message.html,
					text: message.text,
				}),
			});

			if (!response.ok) {
				const detail = await response.text();
				throw new Error(`Resend send failed (${response.status}): ${detail}`);
			}

			const data = (await response.json()) as ResendSuccess;
			if (!data.id) {
				throw new Error("Resend send failed: response did not include a message id");
			}
			return { providerMessageId: data.id };
		},
	};
}
