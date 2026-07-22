import { parseApiResponse } from "@/lib/api/client-response";
import { authFetch } from "@/lib/auth/client";

export type MessageFilter = {
	id: string;
	name: string;
	fromContains: string | null;
	toContains: string | null;
	subjectContains: string | null;
	hasWords: string | null;
	actionStar: boolean;
	actionMarkRead: boolean;
	actionArchive: boolean;
	actionLabelId: string | null;
	actionMoveToTrash: boolean;
	enabled: boolean;
};

export type FilterLabel = { id: string; name: string; color: string };

export async function fetchMessageFilters(): Promise<MessageFilter[]> {
	const response = await authFetch("/api/filters");
	const data = await parseApiResponse<{ filters: MessageFilter[] }>(response);
	return data.filters;
}

export async function fetchFilterLabels(): Promise<FilterLabel[]> {
	const response = await authFetch("/api/labels");
	return parseApiResponse<FilterLabel[]>(response);
}
