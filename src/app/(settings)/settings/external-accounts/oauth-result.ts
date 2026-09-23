/**
 * Maps the `connected` / `error` values that the external OAuth callback appends to
 * `/settings/external-accounts` into a user-facing notice. Unknown codes fall back to
 * a generic message so query-string content is never rendered.
 */
export type ExternalOAuthNotice = { tone: "success" | "error"; message: string };

type SearchParamsReader = { get(name: string): string | null };

const ERROR_MESSAGES: Record<string, string> = {
	"provider-denied": "Authorization was cancelled or denied by the provider. No account was connected.",
	invalid: "The provider response was incomplete or has expired. Start the connection again.",
	reauthenticate: "Your password confirmation expired before the provider returned. Confirm your password and connect again.",
	forbidden: "You no longer have permission to connect an account to that mailbox.",
	"already-connected": "That external account is already connected to this mailbox.",
	unavailable: "The provider could not be reached or rejected the connection. Try again in a few minutes.",
};

const GENERIC_ERROR = "The external account could not be connected. Try again.";

export function describeExternalOAuthResult(params: SearchParamsReader): ExternalOAuthNotice | null {
	const error = params.get("error");
	if (error !== null) {
		return {
			tone: "error",
			message: Object.hasOwn(ERROR_MESSAGES, error) ? ERROR_MESSAGES[error] : GENERIC_ERROR,
		};
	}
	if (params.get("connected") !== null) {
		return { tone: "success", message: "External account connected. The initial import will start shortly." };
	}
	return null;
}
