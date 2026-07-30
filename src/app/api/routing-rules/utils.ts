import type { ForwardRefusalReason } from "@/lib/email/forwarding";

// Promoted to the shared response module (T-11); re-exported so existing
// imports keep working until routes migrate.
export { firstZodMessage } from "@/lib/api/response";

export function forwardRefusalMessage(reason: ForwardRefusalReason): string {
	switch (reason) {
		case "invalid_address":
			return "A valid forwarding destination is required";
		case "managed_domain":
			return "Cannot forward to an address on a domain Lumimail manages";
		case "not_verified":
			return "That destination has not confirmed Cloudflare's verification email yet";
		default:
			return "Register this forwarding destination before using it";
	}
}
