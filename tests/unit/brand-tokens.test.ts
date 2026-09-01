import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const css = readFileSync(path.join(root, "src", "app", "globals.css"), "utf8");
const layout = readFileSync(path.join(root, "src", "app", "layout.tsx"), "utf8");
const button = readFileSync(path.join(root, "src", "components", "ui", "button.tsx"), "utf8");

function variables(selector: string) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const block = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
	return Object.fromEntries(
		[...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1], match[2]]),
	);
}

function luminance(hex: string) {
	const channels = hex
		.match(/[0-9a-f]{2}/gi)!
		.map((channel) => Number.parseInt(channel, 16) / 255)
		.map((channel) =>
			channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
		);
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
	const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
	return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("Picket presentation tokens", () => {
	it.each([
		[":root", "surface"],
		[":root[data-theme=\"dark\"]", "surface"],
	])("keeps semantic text roles accessible in %s", (selector) => {
		const palette = variables(selector);
		const pairs = [
			["ink", "surface"],
			["ink-muted", "surface"],
			["accent", "surface"],
			["accent-ink", "accent"],
			["brand-signal-ink", "brand-signal"],
			["danger", "surface"],
			["success", "surface"],
			["warning", "surface"],
			["info", "surface"],
		] as const;

		for (const [foreground, background] of pairs) {
			expect(palette[foreground], `${selector} is missing --${foreground}`).toBeDefined();
			expect(palette[background], `${selector} is missing --${background}`).toBeDefined();
			expect(
				contrast(palette[foreground], palette[background]),
				`${selector} --${foreground} on --${background}`,
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("maps the Mantle brand roles and type system into Tailwind", () => {
		expect(css).toContain("--color-brand-signal: var(--brand-signal)");
		expect(css).toContain("--color-brand-signal-muted: var(--brand-signal-muted)");
		expect(css).toContain("--color-brand-signal-ink: var(--brand-signal-ink)");
		expect(css).toContain("--font-sans: var(--font-body)");
		expect(css).toContain("--font-display: var(--font-picket-display)");
		expect(layout).toContain("IBM_Plex_Sans");
		expect(layout).toContain("Plus_Jakarta_Sans");
	});

	it("does not assume white text is readable on every action color", () => {
		expect(button).toContain("text-[var(--accent-ink)]");
		expect(button).not.toContain('default: "bg-[var(--accent)] text-white');
	});
});
