import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
	return readFileSync(path, "utf8");
}

/**
 * F53 found the floating language selector sitting on top of the popup composer's
 * Send button, and fixed it by ordering their z-indexes. This test asserted that
 * ordering.
 *
 * F71 moved both preference controls into the header, which removes the hazard rather
 * than ordering around it: a control in normal document flow cannot overlap a fixed
 * composer at any z-index. The assertion is therefore the stronger one — that neither
 * control is fixed-positioned at all — because pinning the old z-index values would
 * now be testing a layout that no longer exists.
 */
describe("preference controls cannot cover the popup composer", () => {
	it("keeps the language and theme controls out of fixed positioning", () => {
		for (const path of [
			"src/components/language-switcher.tsx",
			"src/components/theme-toggle.tsx",
		]) {
			// `relative` on the language control is deliberate — it anchors the
			// transparent <select> over its own icon, and scrolls with the header.
			expect(source(path), path).not.toContain("fixed");
		}
	});

	it("leaves the composer free to own the bottom-right corner", () => {
		expect(source("src/components/compose/compose-form.tsx")).toContain(
			"fixed bottom-4 right-4 z-40",
		);
	});
});
