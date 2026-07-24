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
	mailboxId?: string;
};

export async function submitMessage(
	input: SubmitMessageInput,
): Promise<{ messageId: string; status: "queued" }> {
	const response = await authFetch("/api/send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<{ messageId: string; status: "queued" }>(response);
}

export async function uploadMessageAttachment(messageId: string, file: File): Promise<void> {
	const formData = new FormData();
	formData.append("file", file);
	formData.append("messageId", messageId);
	const response = await authFetch("/api/attachments", { method: "POST", body: formData });
	await parseApiResponse(response);
}
