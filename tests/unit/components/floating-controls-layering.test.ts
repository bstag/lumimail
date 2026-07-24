import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
	return readFileSync(path, "utf8");
}

describe("floating control layering", () => {
	it("keeps global preference controls below the popup composer", () => {
		const languageSwitcher = source("src/components/language-switcher.tsx");
		const themeToggle = source("src/components/theme-toggle.tsx");
		const composeForm = source("src/components/compose/compose-form.tsx");

		expect(languageSwitcher).toContain("fixed bottom-4 right-4 z-30");
		expect(themeToggle).toContain("fixed bottom-4 left-4 z-30");
		expect(composeForm).toContain("fixed bottom-4 right-4 z-40");
	});
});
