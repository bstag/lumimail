import { describe, expect, it } from "vitest";
import { prepareMessageBody } from "@/lib/email/message-body-storage";

describe("message body storage", () => {
	it("keeps ordinary HTML and text directly in D1", () => {
		expect(prepareMessageBody("Hello", "<p>Hello</p>")).toEqual({
			textBody: "Hello", htmlBody: "<p>Hello</p>", overflow: [],
		});
	});

	it("preserves oversized Unicode body parts as full downloads and bounds the database preview", () => {
		const text = "郵".repeat(550_000);
		const html = "<p>Formatted</p>";
		const body = prepareMessageBody(text, html);
		expect(body.htmlBody).toBeNull();
		expect(body.textBody!.length).toBeLessThan(text.length);
		expect(body.overflow.map(({ filename }) => filename)).toEqual(["message-body.txt", "message-body.html"]);
		expect(new TextDecoder().decode(body.overflow[0].content)).toBe(text);
		expect(new TextDecoder().decode(body.overflow[1].content)).toBe(html);
	});

	it("uses readable text as the preview when HTML is the only body", () => {
		const html = `<p>${"郵".repeat(550_000)}</p>`;
		const body = prepareMessageBody(null, html);
		expect(body.textBody).toMatch(/^郵/);
		expect(body.overflow).toHaveLength(1);
		expect(body.overflow[0].filename).toBe("message-body.html");
	});

	it("can store a plain body overflow with no HTML", () => {
		const body = prepareMessageBody("郵".repeat(550_000), null);
		expect(body.overflow.map(({ filename }) => filename)).toEqual(["message-body.txt"]);
	});
});
