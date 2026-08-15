import { getEmailDisplayName } from "@/lib/email/address";

export const DEFAULT_CONVERSATION_PANEL_WIDTH = 560;
export const MIN_CONVERSATION_PANEL_WIDTH = 360;
export const MAX_CONVERSATION_PANEL_WIDTH = 900;
export const MIN_CONVERSATION_LIST_WIDTH = 360;

export const DEFAULT_CONVERSATION_PANEL_HEIGHT = 420;
export const MIN_CONVERSATION_PANEL_HEIGHT = 240;
export const MAX_CONVERSATION_PANEL_HEIGHT = 720;
export const MIN_CONVERSATION_LIST_HEIGHT = 240;

export type SplitOrientation = "right" | "bottom";

/** Unknown or absent stored values fail closed to the right-hand panel. */
export function parseSplitOrientation(raw: string | null): SplitOrientation {
	return raw === "bottom" ? "bottom" : "right";
}

export function parseSelectedMessageId(params: URLSearchParams): string | null {
	const values = params.getAll("message");
	if (values.length !== 1) return null;
	return /^msg_[A-Za-z0-9_-]{1,64}$/.test(values[0]) ? values[0] : null;
}

export function clampConversationPanelWidth(raw: string | number | null, viewportWidth: number): number {
	const parsed = typeof raw === "number" ? raw : raw === null ? Number.NaN : Number(raw);
	const requested = Number.isFinite(parsed) ? parsed : DEFAULT_CONVERSATION_PANEL_WIDTH;
	const viewportMaximum = Math.max(
		MIN_CONVERSATION_PANEL_WIDTH,
		viewportWidth - MIN_CONVERSATION_LIST_WIDTH,
	);
	const maximum = Math.min(MAX_CONVERSATION_PANEL_WIDTH, viewportMaximum);
	return Math.round(Math.min(maximum, Math.max(MIN_CONVERSATION_PANEL_WIDTH, requested)));
}

export function clampConversationPanelHeight(raw: string | number | null, viewportHeight: number): number {
	const parsed = typeof raw === "number" ? raw : raw === null ? Number.NaN : Number(raw);
	const requested = Number.isFinite(parsed) ? parsed : DEFAULT_CONVERSATION_PANEL_HEIGHT;
	const viewportMaximum = Math.max(
		MIN_CONVERSATION_PANEL_HEIGHT,
		viewportHeight - MIN_CONVERSATION_LIST_HEIGHT,
	);
	const maximum = Math.min(MAX_CONVERSATION_PANEL_HEIGHT, viewportMaximum);
	return Math.round(Math.min(maximum, Math.max(MIN_CONVERSATION_PANEL_HEIGHT, requested)));
}

export function getConversationInitial(value: string): string {
	const display = getEmailDisplayName(value).trim();
	return display ? [...display][0].toLocaleUpperCase() : "?";
}
