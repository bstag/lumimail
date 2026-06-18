import { createCloudflareProvider } from "./cloudflare";
import { createResendProvider } from "./resend";
import type { OutboundProvider } from "./types";

export type { OutboundMessage, OutboundProvider, OutboundSendResult } from "./types";

/**
 * Resolve the configured outbound provider.
 *
 * Selected by the `MAIL_PROVIDER` env var (case-insensitive). Defaults to
 * `cloudflare` so existing deployments are unaffected.
 */
export function selectOutboundProvider(env: CloudflareEnv): OutboundProvider {
	const provider = (env.MAIL_PROVIDER ?? "cloudflare").trim().toLowerCase();
	switch (provider) {
		case "cloudflare":
			return createCloudflareProvider(env);
		case "resend":
			return createResendProvider(env);
		default:
			throw new Error(`Unknown MAIL_PROVIDER: ${env.MAIL_PROVIDER}`);
	}
}
