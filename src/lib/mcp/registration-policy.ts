import type {
	ClientRegistrationCallbackOptions,
	ClientRegistrationCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import { rateLimitIp } from "@/lib/rate-limit";

const REGISTRATION_LIMIT = 20;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;

/** Public DCR remains a compatibility endpoint, so keep its write surface bounded and fail closed. */
export async function enforceMcpClientRegistrationPolicy(
	env: CloudflareEnv,
	options: ClientRegistrationCallbackOptions,
): Promise<ClientRegistrationCallbackResult | undefined> {
	if ("software_statement" in options.clientMetadata) {
		return {
			code: "unapproved_software_statement",
			description: "Software statements are not accepted",
			status: 400,
		};
	}

	try {
		const result = await rateLimitIp(
			env,
			options.request,
			"mcp-client-registration",
			REGISTRATION_LIMIT,
			REGISTRATION_WINDOW_MS,
		);
		if (!result.allowed) {
			return {
				code: "temporarily_unavailable",
				description: "Client registration rate limit exceeded",
				status: 429,
			};
		}
		return undefined;
	} catch {
		console.error("MCP client registration rate limit unavailable");
		return {
			code: "server_error",
			description: "Client registration is temporarily unavailable",
			status: 503,
		};
	}
}
