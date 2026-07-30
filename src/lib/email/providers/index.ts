import { createCloudflareProvider } from "./cloudflare";
import { createResendProvider } from "./resend";
import { OutboundProviderError, type OutboundProvider } from "./types";

export type { OutboundMessage, OutboundProvider, OutboundSendResult } from "./types";

/**
 * Resolve the configured outbound provider.
 *
 * Selected by the `MAIL_PROVIDER` env var (case-insensitive). Defaults to
 * `cloudflare` so existing deployments are unaffected.
 *
 * Config errors are thrown as retryable `OutboundProviderError`s: selection
 * happens inside the queue consumer's send path, and a transient deploy
 * misconfiguration must re-queue jobs (bounded by the queue's retry/DLQ
 * policy) rather than finalize them as failed.
 */
export function selectOutboundProvider(env: CloudflareEnv): OutboundProvider {
	const provider = (env.MAIL_PROVIDER ?? "cloudflare").trim().toLowerCase();
	switch (provider) {
		case "cloudflare":
			return createCloudflareProvider(env);
		case "resend":
			return createResendProvider(env);
		default:
			throw new OutboundProviderError(`Unknown MAIL_PROVIDER: ${env.MAIL_PROVIDER}`, {
				retryable: true,
				code: "PROVIDER_CONFIG",
			});
	}
}
