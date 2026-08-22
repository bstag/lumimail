// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
	resolveCidSources,
	sanitizeMessageHtml,
} from "@/components/messages/safe-message-html";

describe("resolveCidSources", () => {
	it("maps authorized inline CIDs and removes unresolved sources", () => {
		expect(resolveCidSources(
			'<p><img src="cid:chart_1"><img src="cid:missing"></p>',
			[
				{ id: "att_1", contentId: "chart_1", disposition: "inline" },
				{ id: "att_2", contentId: "other", disposition: "attachment" },
			],
		)).toBe(
			'<p><img src="/api/attachments/att_1?disposition=inline"><img ></p>',
		);
	});
});

describe("sanitizeMessageHtml", () => {
	it("keeps safe CID images and removes unsafe image sources", () => {
		const sanitized = sanitizeMessageHtml(
			'<p><img src="cid:safe_1"><img src="https://tracker.example/pixel.png"></p>',
		);
		expect(sanitized).toContain('src="cid:safe_1"');
		expect(sanitized).not.toContain("tracker.example");
	});

	it("normalizes safe styles and drops styles with no allowed declarations", () => {
		const sanitized = sanitizeMessageHtml(
			'<span style="color: rgb(1,2,3); position: fixed">Text</span><script>alert(1)</script>',
		);
		expect(sanitized).toContain("color: rgb(1, 2, 3)");
		expect(sanitized).not.toContain("position");
		expect(sanitized).not.toContain("script");
		expect(sanitizeMessageHtml('<p style="position: fixed">Text</p>')).not.toContain("style=");
	});
});
