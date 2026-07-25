export type RoutingFormState = {
	domainId: string;
	pattern: string;
	action: "store" | "forward" | "reject";
	mailboxId: string;
	forwardTo: string;
};

export function filterMailboxesByDomain<T extends { domainId: string }>(rows: T[], domainId: string): T[] {
	return domainId ? rows.filter((row) => row.domainId === domainId) : [];
}

export function canSubmitRoutingRule(state: RoutingFormState): boolean {
	if (!state.domainId || !state.pattern.trim()) return false;
	if (state.action === "store") return Boolean(state.mailboxId);
	if (state.action === "forward") return Boolean(state.forwardTo.trim());
	return true;
}

function specificity(pattern: string): number {
	if (pattern === "*") return 2;
	return pattern.includes("@") ? 0 : 1;
}

export function sortRoutingRules<T extends { pattern: string; priority: number }>(rows: T[]): T[] {
	return [...rows].sort((a, b) => {
		const rank = specificity(a.pattern) - specificity(b.pattern);
		return rank || b.priority - a.priority;
	});
}

/**
 * Extracts a displayable message from either envelope shape.
 *
 * `{ success, error: { message } }` is the canonical form from F40. The bare
 * `{ error: "..." }` string is still produced by `guardUser`, so both must be
 * understood or an authentication failure would surface as a generic error.
 */
function readErrorMessage(body: unknown): string | null {
	if (typeof body !== "object" || body === null || !("error" in body)) return null;

	const error = (body as { error?: unknown }).error;
	if (typeof error === "string") return error;
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return null;
}

export async function readRoutingResponse<T>(response: Response): Promise<T> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error("Routing request failed");
	}
	if (!response.ok) {
		throw new Error(readErrorMessage(body) ?? "Routing request failed");
	}
	// Unwrap the F40 envelope so callers keep receiving the payload directly.
	if (typeof body === "object" && body !== null && "success" in body && "data" in body) {
		return (body as { data: T }).data;
	}
	return body as T;
}
