const LOCAL_PART = /^[a-z0-9.!#$%&'+/=?^_`{|}~-]{1,64}$/i;

export type RoutingPatternResult =
	| { ok: true; pattern: string }
	| { ok: false; error: string };

export function normalizeRoutingPattern(pattern: string, hostname: string): RoutingPatternResult {
	const normalized = pattern.trim().toLowerCase();
	const domain = hostname.trim().toLowerCase();

	if (!normalized) return { ok: false, error: "Pattern is required" };
	if (normalized === "*") return { ok: true, pattern: "*" };

	if (normalized.startsWith("*@")) {
		return normalized.slice(2) === domain
			? { ok: true, pattern: "*" }
			: { ok: false, error: "Catch-all domain must match the selected domain" };
	}
	if (normalized.includes("*")) return { ok: false, error: "Unsupported wildcard pattern" };

	const at = normalized.lastIndexOf("@");
	if (at >= 0) {
		const local = normalized.slice(0, at);
		const addressDomain = normalized.slice(at + 1);
		if (addressDomain !== domain) {
			return { ok: false, error: "Address domain must match the selected domain" };
		}
		if (!LOCAL_PART.test(local)) {
			return { ok: false, error: "Enter a local part, full address, or *" };
		}
		return { ok: true, pattern: `${local}@${domain}` };
	}

	return LOCAL_PART.test(normalized)
		? { ok: true, pattern: normalized }
		: { ok: false, error: "Enter a local part, full address, or *" };
}
