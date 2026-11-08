import { describe, expect, it, vi } from "vitest";

vi.mock("postal-mime", () => ({ default: { parse: vi.fn() } }));

import PostalMime from "postal-mime";
import { buildSnippet, parseRawMime, unsubscribeColumns } from "@/lib/email/parse";

const parseMock = PostalMime.parse as unknown as ReturnType<typeof vi.fn>;

describe("parseRawMime", () => {
	it("retains a valid original Date and rejects malformed dates", async () => {
		parseMock.mockResolvedValue({ date: "Fri, 02 Oct 2026 12:00:00 +0000" });
		expect((await parseRawMime(new ArrayBuffer(0))).receivedAt).toEqual(new Date("2026-10-02T12:00:00Z"));
		parseMock.mockResolvedValue({ date: "not a date" });
		expect((await parseRawMime(new ArrayBuffer(0))).receivedAt).toBeNull();
	});
	it("maps a fully-populated message", async () => {
		parseMock.mockResolvedValue({
			subject: "Hi",
			text: "Hello body",
			html: "<p>safe</p>",
			messageId: "<abc@example.com>",
			inReplyTo: "<parent@example.com>",
			references: "<root@example.com> <parent@example.com>",
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
		expect(result.inReplyTo).toBe("<parent@example.com>");
		expect(result.references).toBe("<root@example.com> <parent@example.com>");
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

	it("drops sender-hidden preheaders from received HTML", async () => {
		parseMock.mockResolvedValue({ html: '<div style="display:none">Preview</div><p>Body</p>' });

		expect((await parseRawMime(new ArrayBuffer(0))).html).toBe("<p>Body</p>");
	});

	it("captures List-Unsubscribe targets and RFC 8058 one-click support", async () => {
		parseMock.mockResolvedValue({ headers: [
			{ key: "list-unsubscribe", value: "<mailto:leave@lists.example?subject=unsub>, <https://example.com/u?id=1>" },
			{ key: "list-unsubscribe-post", value: "List-Unsubscribe=One-Click" },
		] });
		expect(await parseRawMime(new ArrayBuffer(0))).toMatchObject({
			unsubscribeUrl: "https://example.com/u?id=1",
			unsubscribeMailto: "mailto:leave@lists.example?subject=unsub",
			unsubscribeOneClick: true,
		});

		parseMock.mockResolvedValue({ headers: [
			{ key: "list-unsubscribe", value: "<http://insecure.example/u>, <javascript:alert(1)>, <mailto:>, <not a url>" },
			{ key: "list-unsubscribe-post", value: "List-Unsubscribe=One-Click" },
		] });
		expect(await parseRawMime(new ArrayBuffer(0))).toMatchObject({
			unsubscribeUrl: null, unsubscribeMailto: null, unsubscribeOneClick: false,
		});

		parseMock.mockResolvedValue({});
		expect(await parseRawMime(new ArrayBuffer(0))).toMatchObject({
			unsubscribeUrl: null, unsubscribeMailto: null, unsubscribeOneClick: false,
		});
	});

	it("falls back to null for missing fields", async () => {
		parseMock.mockResolvedValue({});

		const result = await parseRawMime(new ArrayBuffer(0));
		expect(result).toEqual({
			receivedAt: null,
			subject: null,
			text: null,
			html: null,
			messageId: null,
			inReplyTo: null,
			references: null,
			unsubscribeUrl: null,
			unsubscribeMailto: null,
			unsubscribeOneClick: false,
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

describe("unsubscribeColumns", () => {
	it("defaults absent targets to empty columns", () => {
		expect(unsubscribeColumns({})).toEqual({ unsubscribeUrl: null, unsubscribeMailto: null, unsubscribeOneClick: false });
		expect(unsubscribeColumns({ unsubscribeUrl: "https://x.test/u", unsubscribeMailto: "mailto:a@x.test", unsubscribeOneClick: true }))
			.toEqual({ unsubscribeUrl: "https://x.test/u", unsubscribeMailto: "mailto:a@x.test", unsubscribeOneClick: true });
	});
});
