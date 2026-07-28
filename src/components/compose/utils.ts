import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import type { ComposeDraft, DraftResponse } from "./types";

export async function fetchDraft(draftId: string): Promise<ComposeDraft> {
	const res = await authFetch(`/api/drafts/${draftId}`);
	const json = (await res.json()) as DraftResponse;

	if (!res.ok || !json.draft) {
		throw new Error(json.error ?? "Failed to load draft");
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
	replyToMessageId?: string;
};

export async function submitMessage(
	input: SubmitMessageInput,
	attachments: File[] = [],
): Promise<{ messageId: string; status: "queued" }> {
	if (attachments.length > 0) {
		const formData = new FormData();
		formData.set("payload", JSON.stringify(input));
		for (const attachment of attachments) formData.append("attachment", attachment);
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
