import { apiError } from "@/lib/api/response";
import { AttachmentValidationError } from "@/lib/email/outbound-attachments";

/**
 * Maps a failure thrown by the outbound send pipeline to its API response.
 * Shared by /api/send and /api/v1/send so both surfaces return identical
 * statuses and messages. Sender/reply-source failures answer 404 (not 403) so
 * the response cannot confirm that a mailbox or message exists.
 */
export function mapSendError(error: unknown): Response {
	if (error instanceof AttachmentValidationError) {
		return apiError(error.message, 400);
	}
	if (error instanceof Error && error.name === "SenderNotAllowedError") {
		return apiError("Mailbox not found", 404);
	}
	if (error instanceof Error && error.name === "ReplySourceNotAllowedError") {
		return apiError("Reply source not found", 404);
	}
	return apiError("Send failed", 500);
}
