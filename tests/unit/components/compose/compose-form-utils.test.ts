import { describe, expect, it } from "vitest";
import {
	buildForwardQuote,
	escapeHtml,
	plainTextToHtml,
	withoutInlineImages,
} from "@/components/compose/compose-form-utils";

describe("escapeHtml", () => {
	it("escapes ampersands and angle brackets", () => {
		expect(escapeHtml('<b>&"x"</b>')).toBe('&lt;b&gt;&amp;"x"&lt;/b&gt;');
	});
});

describe("plainTextToHtml", () => {
	it("returns empty for empty input", () => {
		expect(plainTextToHtml("")).toBe("");
	});

	it("splits blank-line paragraphs and converts single newlines to <br>", () => {
		expect(plainTextToHtml("a\nb\n\nc")).toBe("<p>a<br>b</p><p>c</p>");
	});

	it("normalizes CRLF and escapes markup", () => {
		expect(plainTextToHtml("x<y\r\nz")).toBe("<p>x&lt;y<br>z</p>");
	});
});

describe("withoutInlineImages", () => {
	it("removes cid images and keeps other images", () => {
		const html = '<p>a<img src="cid:img_1" alt="x">b<img src="https://e/x.png">c</p>';
		expect(withoutInlineImages(html)).toBe('<p>ab<img src="https://e/x.png">c</p>');
	});

	it("matches case-insensitively and with single quotes", () => {
		expect(withoutInlineImages("<IMG SRC='cid:abc'>")).toBe("");
	});
});

describe("buildForwardQuote", () => {
	it("includes sender, subject, and original body", () => {
		const quote = buildForwardQuote({ fromAddr: "a@b.c", subject: "Hi" }, "body");
		expect(quote).toContain("From: a@b.c");
		expect(quote).toContain("Subject: Hi");
		expect(quote).toContain("body");
	});

	it("tolerates missing metadata", () => {
		const quote = buildForwardQuote(undefined, "x");
		expect(quote).toContain("From: \n");
		expect(quote).toContain("Subject: \n");
	});
});
