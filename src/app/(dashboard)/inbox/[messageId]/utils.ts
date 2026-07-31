import { authFetch } from "@/lib/auth/client";
import { parseApiResponse, type ApiResponseError } from "@/lib/api/client-response";
import { getEmailAddress } from "@/lib/email/address";
import { getDisplayNameForAddress } from "@/lib/contacts/utils";
import { htmlToReadableText, splitRepliedEmailContent } from "@/lib/email/reply-content-utils";
import type { Message } from "@/hooks/types";
import type { MessageBodyDisplay, MessageDetailResponse } from "./types";

export async function fetchMessageDetail(messageId: string): Promise<MessageDetailResponse> {
	const response = await authFetch(`/api/messages/${messageId}`);
	try {
		return await parseApiResponse<MessageDetailResponse>(response);
	} catch (error) {
		// parseApiResponse only throws ApiResponseError. The page renders
		// `error` inline for a missing/inaccessible message rather than an
		// error boundary, matching the pre-envelope behavior.
		return { error: (error as ApiResponseError).message };
	}
}

export function getMessageHeaderParties(message: Message) {
	return {
		fromName: getDisplayNameForAddress(message.fromAddr, message.fromContactName),
		fromAddress: getEmailAddress(message.fromAddr),
		toName: getDisplayNameForAddress(message.toAddr, message.toContactName),
	};
}

export function getMessageBodyDisplay(
	textBody: string | null | undefined,
	htmlBody: string | null | undefined,
	fallback: string | null | undefined,
): MessageBodyDisplay {
	const textSource = textBody ?? (htmlToReadableText(htmlBody) || fallback || "");
	const parts = splitRepliedEmailContent(textSource);
	const renderedHtml = htmlBody ?? null;

	return {
		latestContent: parts.latestContent,
		quotedContent: renderedHtml ? [] : parts.quotedContent,
		htmlBody: renderedHtml,
		hasQuotedContent: renderedHtml ? false : parts.quotedContent.length > 0,
	};
}
