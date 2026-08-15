/**
 * Strips line and block comments (outside strings) and trailing commas so a
 * wrangler JSONC file can be parsed with `JSON.parse` and asserted
 * structurally rather than by raw substring matching.
 */
export function parseJsonc(text: string): unknown {
	let stripped = "";
	let inString = false;
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (inString) {
			stripped += ch;
			if (ch === "\\") {
				stripped += text[i + 1] ?? "";
				i += 2;
				continue;
			}
			if (ch === '"') inString = false;
			i += 1;
			continue;
		}
		if (ch === '"') {
			inString = true;
			stripped += ch;
			i += 1;
			continue;
		}
		if (ch === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			continue;
		}
		if (ch === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
			i += 2;
			continue;
		}
		stripped += ch;
		i += 1;
	}
	// Trailing commas (valid JSONC, invalid JSON): remove any comma whose next
	// non-whitespace character closes an object or array.
	return JSON.parse(stripped.replace(/,(\s*[}\]])/g, "$1"));
}
