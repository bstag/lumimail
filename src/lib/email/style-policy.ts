function safeColor(value: string): string | null {
	const candidate = value.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(candidate)) return candidate;
	const match = candidate.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
	if (!match) return null;
	const channels = match.slice(1).map(Number);
	if (channels.some((channel) => channel > 255)) return null;
	return `rgb(${channels.join(", ")})`;
}

export function sanitizeEmailStyle(tag: string, style: string | null): string | null {
	const allowed = new Map<string, string>();
	for (const declaration of (style ?? "").split(";")) {
		const separator = declaration.indexOf(":");
		if (separator < 0) continue;
		const property = declaration.slice(0, separator).trim().toLowerCase();
		const rawValue = declaration.slice(separator + 1);
		if (property === "text-align" && ["p", "h1", "h2"].includes(tag)) {
			const value = rawValue.trim().toLowerCase();
			if (value === "left" || value === "center" || value === "right" || value === "justify") {
				allowed.set(property, value);
			}
		}
		if (
			(property === "color" || property === "background-color")
			&& (tag === "span" || tag === "mark")
		) {
			const value = safeColor(rawValue);
			if (value) allowed.set(property, value);
		}
	}
	return allowed.size
		? [...allowed].map(([property, value]) => `${property}: ${value};`).join(" ")
		: null;
}
