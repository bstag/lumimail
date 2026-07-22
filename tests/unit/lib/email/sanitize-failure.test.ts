import { describe, expect, it, vi } from "vitest";

vi.mock("linkedom", () => ({
	parseHTML: () => {
		throw new Error("parser unavailable");
	},
}));

import { sanitizeHtml } from "@/lib/email/sanitize";

describe("sanitizeHtml failure behavior", () => {
	it("fails closed by escaping the original markup when parsing throws", () => {
		expect(sanitizeHtml('<img src=x onerror="alert(1)"><script>boom</script>')).toBe(
			'&lt;img src=x onerror="alert(1)"&gt;&lt;script&gt;boom&lt;/script&gt;',
		);
	});
});
