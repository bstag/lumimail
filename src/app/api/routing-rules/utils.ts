import type { ForwardRefusalReason } from "@/lib/email/forwarding";

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
