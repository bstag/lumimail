import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import type { ComposeDraft, DraftResponse } from "./types";

export async function fetchDraft(draftId: string): Promise<ComposeDraft> {
	const res = await authFetch(`/api/drafts/${draftId}`);
	const json = await parseApiResponse<DraftResponse>(res);

	if (!json.draft) {
		throw new Error("Failed to load draft");
	}

	return json.draft;
}

export type SubmitMessageInput = {
	from: string;
	to: string;
	subject: string;
	text: string;
	html?: string;
	mailboxId?: string;
	externalAccountId?: string;
	replyToMessageId?: string;
};

export type InlineImageUpload = {
	file: File;
	contentId: string;
};

export async function submitMessage(
	input: SubmitMessageInput,
	attachments: File[] = [],
	inlineImages: InlineImageUpload[] = [],
): Promise<{ messageId: string; status: "queued" }> {
	if (attachments.length > 0 || inlineImages.length > 0) {
		const formData = new FormData();
		formData.set("payload", JSON.stringify(input));
		for (const attachment of attachments) formData.append("attachment", attachment);
		for (const image of inlineImages) {
			formData.append("inlineImage", image.file);
			formData.append("inlineImageId", image.contentId);
		}
		const response = await authFetch("/api/send", { method: "POST", body: formData });
		return parseApiResponse<{ messageId: string; status: "queued" }>(response);
	}
	const response = await authFetch("/api/send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<{ messageId: string; status: "queued" }>(response);
}
