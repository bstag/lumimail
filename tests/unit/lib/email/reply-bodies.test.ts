import { describe, expect, it } from "vitest";
import { buildReplyBodies } from "@/lib/email/reply-bodies";

describe("buildReplyBodies", () => {
	it("preserves sanitized source HTML and escapes newly authored text", () => {
		const result = buildReplyBodies("Thanks <team>\nSecond line", {
			fromAddr: "Sender <sender@example.com>",
			textBody: "*plain fallback*",
			htmlBody: `
				<p><strong>Bold</strong> <em>italic</em> <u>underlined</u>
				<a href="https://example.com">safe link</a>
				<script>alert(1)</script><img src="https://tracker.example/pixel"></p>
			`,
		});

		expect(result.text).toContain("Thanks <team>\nSecond line");
		expect(result.text).toContain("On the previous message, Sender <sender@example.com> wrote:");
		expect(result.text).toContain("> *plain fallback*");
		expect(result.html).toContain("Thanks &lt;team&gt;<br>Second line");
		expect(result.html).toContain("<blockquote>");
		expect(result.html).toContain("<strong>Bold</strong>");
		expect(result.html).toContain("<em>italic</em>");
		expect(result.html).toContain("<u>underlined</u>");
		expect(result.html).toContain('href="https://example.com/"');
		expect(result.html).not.toContain("<script");
		expect(result.html).not.toContain("<img");
	});

	it("preserves sanitized authored formatting ahead of the server-owned quotation", () => {
		const result = buildReplyBodies("Thanks team", {
			fromAddr: "Sender",
			textBody: "Earlier",
			htmlBody: "<p>Earlier</p>",
		}, '<p><strong>Thanks</strong> team<script>bad()</script></p>');

		expect(result.html).toContain("<p><strong>Thanks</strong> team</p>");
		expect(result.html).toContain("<blockquote><p>Earlier</p></blockquote>");
		expect(result.html).not.toContain("script");
		expect(result.text).toContain("Thanks team");
	});

	it("uses escaped source text when HTML is absent", () => {
		const result = buildReplyBodies("Reply", {
			fromAddr: "Bad <name>",
			textBody: "one < two\nnext & final",
			htmlBody: null,
		});

		expect(result.html).toContain("Bad &lt;name&gt;");
		expect(result.html).toContain("<blockquote>one &lt; two<br>next &amp; final</blockquote>");
		expect(result.text).toContain("> one < two\n> next & final");
	});

	it("derives readable plain text from an HTML-only source", () => {
		const result = buildReplyBodies("Reply", {
			fromAddr: "Sender",
			textBody: null,
			htmlBody: "<p>Hello <strong>there</strong></p>",
		});

		expect(result.text).toContain("> Hello there");
		expect(result.html).toContain("<p>Hello <strong>there</strong></p>");
	});

	it("emits safe empty alternatives when the source has no body", () => {
		expect(buildReplyBodies("", {
			fromAddr: "",
			textBody: null,
			htmlBody: null,
		})).toEqual({
			text: "\n\nOn the previous message,  wrote:\n> ",
			html: "<div></div><div>On the previous message,  wrote:</div><blockquote></blockquote>",
		});
	});
});
