import { describe, expect, it } from "vitest";
import {
	emailHtmlToText,
	normalizeAuthoredContent,
} from "@/lib/email/authored-content";

describe("normalizeAuthoredContent", () => {
	it("sanitizes semantic HTML and derives the authoritative plain-text alternative", () => {
		expect(normalizeAuthoredContent({
			html: '<h2>Hello <strong>team</strong></h2><p>Visit <a href="https://example.com">the site</a>.</p>',
			text: "untrusted client alternative",
		})).toEqual({
			html: '<h2>Hello <strong>team</strong></h2><p>Visit <a href="https://example.com/" rel="noopener noreferrer nofollow">the site</a>.</p>',
			text: "Hello team\nVisit the site.",
		});
	});

	it("drops active and style-based content before deriving text", () => {
		const result = normalizeAuthoredContent({
			html: '<p style="color:red" onclick="bad()">Safe<script>secret()</script><img src="https://track.test"></p>',
			text: "Safe secret tracking fallback",
		});

		expect(result).toEqual({ html: "<p>Safe</p>", text: "Safe" });
	});

	it("keeps text-only API messages compatible and normalizes newlines", () => {
		expect(normalizeAuthoredContent({ text: "one\r\ntwo\rthree" })).toEqual({
			html: null,
			text: "one\ntwo\nthree",
		});
	});

	it("treats empty editor wrappers as empty content", () => {
		expect(normalizeAuthoredContent({ html: "<p><br></p>", text: "" })).toEqual({
			html: null,
			text: null,
		});
		expect(normalizeAuthoredContent({})).toEqual({ html: null, text: null });
	});

	it("renders list, rule, inline, and non-element nodes as readable text", () => {
		expect(emailHtmlToText(
			"<ul><li>One</li><li>Two</li></ul><hr><span>Tail</span><!-- ignored -->",
		)).toBe("- One\n- Two\n\n---\nTail");
	});
});
