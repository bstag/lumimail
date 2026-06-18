import { describe, expect, it, vi } from "vitest";

vi.mock("postal-mime", () => ({ default: { parse: vi.fn() } }));

import PostalMime from "postal-mime";
import { buildSnippet, parseRawMime } from "@/lib/email/parse";

const parseMock = PostalMime.parse as unknown as ReturnType<typeof vi.fn>;

describe("parseRawMime", () => {
	it("maps a fully-populated message", async () => {
		parseMock.mockResolvedValue({
			subject: "Hi",
			text: "Hello body",
			html: "<p>safe</p>",
			messageId: "<abc@example.com>",
			from: { address: "alice@example.com", name: "Alice" },
			to: [{ address: "bob@example.com", name: "Bob" }],
		});

		const result = await parseRawMime(new ArrayBuffer(0));
		expect(result.subject).toBe("Hi");
		expect(result.text).toBe("Hello body");
		// parse.ts forwards html through sanitizeHtml; the sanitizer's policy is
		// covered by its own test, here we assert the value is wired through.
		expect(result.html).toContain("safe");
		expect(result.messageId).toBe("<abc@example.com>");
		expect(result.fromAddr).toContain("alice@example.com");
		expect(result.toAddr).toContain("bob@example.com");
	});

	it("falls back to null for missing fields", async () => {
		parseMock.mockResolvedValue({});

		const result = await parseRawMime(new ArrayBuffer(0));
		expect(result).toEqual({
			subject: null,
			text: null,
			html: null,
			messageId: null,
			fromAddr: null,
			toAddr: null,
		});
	});
});

describe("buildSnippet", () => {
	it("collapses whitespace from text", () => {
		expect(buildSnippet("  Hello\n\n  world  ", null)).toBe("Hello world");
	});

	it("truncates to the max length", () => {
		expect(buildSnippet("a".repeat(300), null, 10)).toHaveLength(10);
	});

	it("derives readable text from html when text is absent", () => {
		expect(buildSnippet(null, "<p>Hi there</p>")).toContain("Hi there");
	});
});
