import {
	OutboundProviderError,
	type OutboundMessage,
	type OutboundProvider,
	type OutboundSendResult,
} from "./types";

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
			let response: Response;
			try {
				response = await fetch(`${baseUrl}/emails`, {
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
			} catch (error) {
				throw new OutboundProviderError("Resend network request failed", {
					code: "NETWORK_ERROR",
					retryable: true,
					cause: error,
				});
			}

			if (!response.ok) {
				const retryable = response.status === 429 || response.status >= 500;
				throw new OutboundProviderError(`Resend send failed (${response.status})`, {
					code: `HTTP_${response.status}`,
					retryable,
				});
			}

			const data = (await response.json()) as ResendSuccess;
			if (!data.id) {
				throw new OutboundProviderError(
					"Resend send failed: response did not include a message id",
					{ code: "INVALID_RESPONSE", retryable: false },
				);
			}
			return { providerMessageId: data.id };
		},
	};
}
