// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
	countRemoteImages,
	loadRemoteImages,
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

describe("deferred remote images (F96)", () => {
	it("keeps only inert http(s) remote images and never a live remote src", () => {
		const sanitized = sanitizeMessageHtml(
			'<img data-remote-src="https://cdn.example.com/a.png" alt="A">'
			+ '<img data-remote-src="javascript:alert(1)">'
			+ '<img src="https://cdn.example.com/b.png" data-remote-src="https://cdn.example.com/b.png">',
		);
		expect(sanitized).toBe('<img data-remote-src="https://cdn.example.com/a.png" alt="A">');
		expect(countRemoteImages(sanitized)).toBe(1);
		expect(countRemoteImages("<p>none</p>")).toBe(0);
	});

	it("points deferred images at the message-scoped proxy when the reader opts in", () => {
		const loaded = loadRemoteImages(
			'<p><img data-remote-src="https://cdn.example.com/a.png?x=1&amp;y=2" alt="A"></p>',
			"msg_1",
		);
		expect(loaded).toBe(
			'<p><img alt="A" src="/api/messages/msg_1/remote-image?u=https%3A%2F%2Fcdn.example.com%2Fa.png%3Fx%3D1%26y%3D2"></p>',
		);
	});
});
