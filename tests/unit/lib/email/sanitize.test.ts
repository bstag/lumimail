import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@/lib/email/sanitize";

describe("sanitizeHtml", () => {
	it("returns null for missing or empty input", () => {
		expect(sanitizeHtml(null)).toBeNull();
		expect(sanitizeHtml(undefined)).toBeNull();
		expect(sanitizeHtml("")).toBeNull();
	});

	it("keeps only normalized editor presentation styles", () => {
		expect(sanitizeHtml(
			'<p style="text-align:center;position:fixed;background-image:url(https://evil.test/x)">'
			+ '<span style="color:#2563eb;background-color:rgb(254, 240, 138);font-size:99px">Safe</span>'
			+ "</p>",
		)).toBe(
			'<p style="text-align: center;"><span style="color: #2563eb; background-color: rgb(254, 240, 138);">Safe</span></p>',
		);
	});

	it("keeps CID images but rejects remote, data, and malformed sources", () => {
		expect(sanitizeHtml(
			'<img src="cid:inline_123" alt="Chart" title="Quarterly chart" width="640" height="480">'
			+ '<img src="https://track.test/pixel.png"><img src="data:image/png;base64,AAAA">'
			+ '<img src="cid:../bad"><img>',
		)).toBe(
			'<img src="cid:inline_123" alt="Chart" title="Quarterly chart" width="640" height="480">',
		);
	});

	it("bounds inline-image dimensions and normalizes CID whitespace", () => {
		expect(sanitizeHtml(
			'<img src=" cid:chart_1 " width="0" height="2001">'
			+ '<img src="cid:chart_2" width="abc" height="25">',
		)).toBe(
			'<img src="cid:chart_1"><img src="cid:chart_2" height="25">',
		);
	});

	it("keeps allowlisted structural formatting and ordinary text", () => {
		const result = sanitizeHtml(
			'<div><h2>Heading</h2><p dir="rtl" lang="ar">Hello <strong>world</strong></p><ul><li>One</li></ul></div>',
		);

		expect(result).toContain("<h2>Heading</h2>");
		expect(result).toContain('<p dir="rtl" lang="ar">Hello <strong>world</strong></p>');
		expect(result).toContain("<ul><li>One</li></ul>");
	});

	it("removes active elements together with their content", () => {
		const result = sanitizeHtml(
			'<p>before<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.test">frame</iframe><svg><script>alert(2)</script><text>svg</text></svg><form><input value="secret"><button>submit</button></form>after</p>',
		);

		expect(result).toContain("before");
		expect(result).toContain("after");
		expect(result).not.toMatch(/script|style|iframe|svg|form|input|button/i);
		expect(result).not.toMatch(/alert|display:none|frame|secret|submit|svg/i);
	});

	it("unwraps unknown inert elements while preserving readable children", () => {
		const result = sanitizeHtml("<section>Hello <mark>bright <custom>world</custom></mark></section>");

		expect(result).toContain("Hello <mark>bright world</mark>");
		expect(result).not.toMatch(/section|custom/i);
	});

	it("strips event, style, identity, namespace, and unapproved attributes", () => {
		const result = sanitizeHtml(
			'<p id="clobber" class="x" style="color:red" onclick="alert(1)" data-x="1" xmlns="x">text</p>',
		);

		expect(result).toBe("<p>text</p>");
	});

	it("keeps only explicitly safe link destinations and hardens retained links", () => {
		const result = sanitizeHtml(
			[
				'<a href="https://example.com/path" title="Safe" target="_self">https</a>',
				'<a href="http://example.com">http</a>',
				'<a href="mailto:user@example.com">mail</a>',
				'<a href=" javascript:alert(1)">javascript</a>',
				'<a href="java&#x73;cript:alert(2)">entity</a>',
				'<a href="//evil.test/path">protocol relative</a>',
				'<a href="/relative">relative</a>',
				'<a href="data:text/html,boom">data</a>',
				'<a>missing</a>',
				'<a href="   ">blank</a>',
				'<a href="&#10;https://example.com">control</a>',
				'<a href="java&#10;script:alert(3)">embedded control</a>',
			].join(""),
		);

		expect(result).toContain('href="https://example.com/path"');
		expect(result).toContain('href="http://example.com/"');
		expect(result).toContain('href="mailto:user@example.com"');
		expect(result?.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(4);
		expect(result).not.toMatch(/javascript:|data:|href="\/\//i);
		expect(result).not.toContain('href="/relative"');
		expect(result).not.toContain("target=");
	});

	it("validates blockquote citations and escapes retained attribute values", () => {
		const result = sanitizeHtml(
			'<blockquote cite="https://example.com/source">safe</blockquote><blockquote cite="javascript:alert(1)">unsafe</blockquote><a href="https://example.com" title="A &quot;title&quot; &amp; note">link</a>',
		);

		expect(result).toContain('cite="https://example.com/source"');
		expect(result).toContain("<blockquote>unsafe</blockquote>");
		expect(result).toContain('title="A &quot;title&quot; &amp; note"');
	});

	it("removes images, comments, and remote-resource elements", () => {
		const result = sanitizeHtml(
			'<p>hello<!-- tracking --><img src="https://track.test/pixel" onerror="alert(1)"><link rel="stylesheet" href="https://evil.test/x.css"><meta http-equiv="refresh" content="0;url=https://evil.test"></p>',
		);

		expect(result).toBe("<p>hello</p>");
	});

	it("keeps only bounded table spans and conservative language/direction values", () => {
		const result = sanitizeHtml(
			'<div dir="ltr">left</div><div dir="auto">auto</div><table><tr><td colspan="2" rowspan="9999" dir="sideways" lang="en-US">cell</td><th colspan="0" rowspan="3">head</th></tr></table><p>line<br>rule<hr>end</p>',
		);

		expect(result).toContain('<div dir="ltr">left</div>');
		expect(result).toContain('<div dir="auto">auto</div>');
		expect(result).toMatch(/<td(?=[^>]*\bcolspan="2")(?=[^>]*\blang="en-US")[^>]*>cell<\/td>/);
		expect(result).toContain('<th rowspan="3">head</th>');
		expect(result).toContain("line<br>rule");
		expect(result).toContain("<hr>");
		expect(result).not.toContain("9999");
		expect(result).not.toContain("sideways");
	});

	it("fails closed for malformed mixed content", () => {
		const result = sanitizeHtml('<p>safe<a href="javascript:alert(1)"><b>link<script>bad()</script>tail');

		expect(result).toContain("safe");
		expect(result).toContain("link");
		expect(result).toContain("tail");
		expect(result).not.toMatch(/javascript|script|bad\(\)/i);
	});
});
