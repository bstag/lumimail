// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { resolveCidSources } from "@/components/messages/safe-message-html";

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
