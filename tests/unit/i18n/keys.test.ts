import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const messagesDir = join(process.cwd(), "src/i18n/messages");

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix];
	return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	);
}

function loadLocale(file: string): unknown {
	return JSON.parse(readFileSync(join(messagesDir, file), "utf8"));
}

/**
 * Structural parity guard: every key path present in en.json must exist in
 * every other locale file and vice versa. This is what turns a missed
 * translation into a failing test instead of a runtime fallback (T-35).
 */
describe("i18n message catalogs", () => {
	const files = readdirSync(messagesDir).filter((name) => name.endsWith(".json"));
	const enPaths = new Set(keyPaths(loadLocale("en.json")));

	it("covers the expected locale set", () => {
		expect(files.length).toBe(11);
		expect(files).toContain("en.json");
		expect(files).toContain("ar.json");
	});

	for (const file of files.filter((name) => name !== "en.json")) {
		it(`keeps ${file} structurally identical to en.json`, () => {
			const paths = new Set(keyPaths(loadLocale(file)));
			const missing = [...enPaths].filter((path) => !paths.has(path));
			const extra = [...paths].filter((path) => !enPaths.has(path));
			expect(missing, `${file} is missing keys`).toEqual([]);
			expect(extra, `${file} has keys absent from en.json`).toEqual([]);
		});
	}
});
