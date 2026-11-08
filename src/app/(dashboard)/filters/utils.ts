import { apiJson, parseApiResponse } from "@/lib/api/client-response";
import { authFetch } from "@/lib/auth/client";

export type MessageFilter = {
	id: string;
	name: string;
	fromContains: string | null;
	toContains: string | null;
	subjectContains: string | null;
	hasWords: string | null;
	matchMode: "all" | "any";
	actionStar: boolean;
	actionMarkRead: boolean;
	actionArchive: boolean;
	actionLabelId: string | null;
	actionMoveToTrash: boolean;
	actionFocus: "focused" | "other" | null;
	actionExpireDays: number | null;
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

/** How many existing messages a filter matches (F101). */
export async function previewFilter(id: string): Promise<number> {
	return (await apiJson.get<{ matched: number }>(`/api/filters/${id}/apply`)).matched;
}

/** Applies a filter's actions to the existing mail it matches; returns how many matched. */
export async function applyFilter(id: string): Promise<number> {
	return (await apiJson.post<{ matched: number }>(`/api/filters/${id}/apply`, {})).matched;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

const conditionKeys = [
	["fromContains", "condFrom"], ["subjectContains", "condSubject"], ["toContains", "condTo"], ["hasWords", "condWords"],
] as const;

/** The If and Then lines a filter row shows. */
export function describeFilter(filter: MessageFilter, t: Translate) {
	const conditions = conditionKeys.flatMap(([field, key]) => filter[field] ? [t(key, { value: filter[field] })] : []);
	const actions = [
		filter.actionStar && t("actStar"), filter.actionMarkRead && t("actMarkRead"),
		filter.actionArchive && t("actArchive"), filter.actionMoveToTrash && t("actTrash"),
		filter.actionLabelId && t("actLabel"),
		filter.actionFocus === "focused" && t("actFocused"), filter.actionFocus === "other" && t("actOther"),
		filter.actionExpireDays && t("actExpire", { days: filter.actionExpireDays }),
	].filter((value): value is string => typeof value === "string");
	const ifLine = conditions.length === 0
		? t("noConditions")
		: t(filter.matchMode === "any" ? "ifAnyPrefix" : "ifPrefix", { conditions: conditions.join(", ") });
	return { ifLine, thenLine: t("thenPrefix", { actions: actions.length > 0 ? actions.join(", ") : t("noAction") }) };
}

/** The bare address of a From header such as `"Shop" <deals@shop.test>`. */
export function bareAddress(from: string): string {
	return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

/** The filter form URL prefilled for a message's sender (F101). */
export function filterLikeThisHref(from: string): string {
	return `/filters?from=${encodeURIComponent(bareAddress(from))}`;
}
