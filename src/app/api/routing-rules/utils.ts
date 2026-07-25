import type { ZodError } from "zod";
import type { ForwardRefusalReason } from "@/lib/email/forwarding";

/**
 * The `{ success, error: { message } }` envelope carries a string, so a Zod
 * failure is reduced to its first issue rather than returning a nested flatten
 * object the client cannot render.
 */
export function firstZodMessage(error: ZodError): string {
	const issue = error.issues[0];
	if (!issue) return "Invalid request";
	const path = issue.path.join(".");
	return path ? `${path}: ${issue.message}` : issue.message;
}

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
