import { describe, expect, it } from "vitest";
import { sanitizeEmailStyle } from "@/lib/email/style-policy";

describe("sanitizeEmailStyle", () => {
	it.each([
		["span", "color: nope", null],
		["span", "color: rgb(999, 0, 0)", null],
		["span", "color: rgb(1,2,3)", "color: rgb(1, 2, 3);"],
		["mark", "background-color: #ABCDEF", "background-color: #abcdef;"],
		["p", "text-align: diagonal", null],
		["div", "text-align: center", null],
		["span", null, null],
		["span", "missing-separator", null],
	] as const)("normalizes %s %s", (tag, style, expected) => {
		expect(sanitizeEmailStyle(tag, style)).toBe(expected);
	});
});
