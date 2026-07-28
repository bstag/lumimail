import { describe, expect, it } from "vitest";
import { prepareHtmlForDelivery } from "@/lib/email/delivery-html";

describe("prepareHtmlForDelivery", () => {
	it("adds fixed presentation to semantic headings", () => {
		expect(prepareHtmlForDelivery("<h1>Primary</h1><h2>Secondary</h2><p>Body</p>")).toBe(
			'<h1 style="font-size: 2em; font-weight: 700; line-height: 1.2; margin: 0 0 0.67em;">Primary</h1>'
			+ '<h2 style="font-size: 1.5em; font-weight: 700; line-height: 1.25; margin: 0 0 0.83em;">Secondary</h2>'
			+ "<p>Body</p>",
		);
	});

	it("adds portable presentation to structural email content", () => {
		const result = prepareHtmlForDelivery(
			"<table><tr><th>H</th><td>D</td></tr></table><blockquote>Q</blockquote><pre>C</pre>"
			+ '<img src="cid:chart_1" alt="Chart">',
		);
		expect(result).toContain('<table style="border-collapse: collapse; width: 100%;">');
		expect(result).toContain("<th style=");
		expect(result).toContain("<td style=");
		expect(result).toContain("<blockquote style=");
		expect(result).toContain("<pre style=");
		expect(result).toContain('src="cid:chart_1"');
	});

	it("re-sanitizes input and never preserves user-owned styles", () => {
		expect(prepareHtmlForDelivery(
			'<h1 style="display:none" onclick="bad()">Visible<script>secret()</script></h1>',
		)).toBe(
			'<h1 style="font-size: 2em; font-weight: 700; line-height: 1.2; margin: 0 0 0.67em;">Visible</h1>',
		);
	});

	it("keeps absent or empty HTML absent", () => {
		expect(prepareHtmlForDelivery(undefined)).toBeUndefined();
		expect(prepareHtmlForDelivery(null)).toBeUndefined();
		expect(prepareHtmlForDelivery("")).toBeUndefined();
	});
});
