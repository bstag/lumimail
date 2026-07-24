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
			attachments: [
				{
					filename: "photo.png",
					mimeType: "image/png",
					disposition: "inline",
					contentId: "<photo-1>",
					content: new Uint8Array([9, 8, 7]),
				},
			],
		});

		const result = await parseRawMime(new ArrayBuffer(0));
		expect(parseMock).toHaveBeenCalledWith(
			expect.any(ArrayBuffer),
			{ attachmentEncoding: "arraybuffer" },
		);
		expect(result.subject).toBe("Hi");
		expect(result.text).toBe("Hello body");
		// parse.ts forwards html through sanitizeHtml; the sanitizer's policy is
		// covered by its own test, here we assert the value is wired through.
		expect(result.html).toContain("safe");
		expect(result.messageId).toBe("<abc@example.com>");
		expect(result.fromAddr).toContain("alice@example.com");
		expect(result.toAddr).toContain("bob@example.com");
		expect(result.attachments[0]).toMatchObject({
			filename: "photo.png",
			contentType: "image/png",
			disposition: "inline",
			contentId: "<photo-1>",
		});
		expect(new Uint8Array(result.attachments[0].content)).toEqual(
			new Uint8Array([9, 8, 7]),
		);
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
			attachments: [],
		});
	});

	it("copies Uint8Array windows exactly and encodes defensive string content", async () => {
		const source = new Uint8Array([99, 1, 2, 99]);
		parseMock.mockResolvedValue({
			attachments: [
				{ content: source.subarray(1, 3), filename: null, mimeType: "x/test", disposition: null },
				{ content: "hé", filename: "utf8.txt", mimeType: "text/plain", disposition: "attachment" },
				{ content: new Uint8Array([4, 5]).buffer, filename: "raw.bin", disposition: null },
			],
		});

		const result = await parseRawMime(new ArrayBuffer(0));
		expect(new Uint8Array(result.attachments[0].content)).toEqual(new Uint8Array([1, 2]));
		expect(new Uint8Array(result.attachments[1].content)).toEqual(new TextEncoder().encode("hé"));
		expect(new Uint8Array(result.attachments[2].content)).toEqual(new Uint8Array([4, 5]));
		expect(result.attachments[2].contentType).toBe("");
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
