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

export async function readRoutingResponse<T>(response: Response): Promise<T> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error("Routing request failed");
	}
	if (!response.ok) {
		const message = typeof body === "object" && body !== null && "error" in body
			? (body as { error?: unknown }).error
			: null;
		throw new Error(typeof message === "string" ? message : "Routing request failed");
	}
	return body as T;
}
