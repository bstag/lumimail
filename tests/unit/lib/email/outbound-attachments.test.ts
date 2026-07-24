import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AttachmentValidationError,
	decodeBase64Attachment,
	validateOutboundAttachments,
} from "@/lib/email/outbound-attachments";

const bytes = (value: string) => new TextEncoder().encode(value).buffer;

describe("outbound attachment validation", () => {
	it("normalizes safe filenames and preserves exact bytes", () => {
		const [attachment] = validateOutboundAttachments({
			subject: "Report",
			text: "Attached",
			attachments: [{
				filename: "../quarter\u0000.pdf",
				contentType: "application/pdf",
				content: bytes("pdf"),
			}],
		});

		expect(attachment).toMatchObject({
			filename: "quarter.pdf",
			contentType: "application/pdf",
			size: 3,
		});
		expect(new Uint8Array(attachment.content)).toEqual(new TextEncoder().encode("pdf"));
	});

	it("uses a bounded fallback for an empty normalized filename", () => {
		const [fallback] = validateOutboundAttachments({
			subject: "x",
			attachments: [{
				filename: "../\u0000",
				contentType: "text/plain",
				content: bytes("x"),
			}],
		});
		expect(fallback.filename).toBe("attachment");

		const [bounded] = validateOutboundAttachments({
			subject: "x",
			attachments: [{
				filename: `${"a".repeat(300)}.txt`,
				contentType: "text/plain",
				content: bytes("x"),
			}],
		});
		expect(bounded.filename).toHaveLength(255);
	});

	it.each([
		["script.js", "text/plain"],
		["invoice.pdf.exe", "application/pdf"],
		["photo.jpg", "application/x-msdownload"],
	])("rejects unsafe or unsupported file %s", (filename, contentType) => {
		expect(() => validateOutboundAttachments({
			subject: "x",
			attachments: [{ filename, contentType, content: bytes("x") }],
		})).toThrow(AttachmentValidationError);
	});

	it("rejects more than ten attachments", () => {
		expect(() => validateOutboundAttachments({
			subject: "x",
			attachments: Array.from({ length: 11 }, (_, index) => ({
				filename: `${index}.txt`,
				contentType: "text/plain",
				content: bytes("x"),
			})),
		})).toThrow(/Too many attachments/);
	});

	it("rejects an individual attachment over 3 MiB", () => {
		expect(() => validateOutboundAttachments({
			subject: "x",
			attachments: [{
				filename: "large.pdf",
				contentType: "application/pdf",
				content: new ArrayBuffer(3 * 1024 * 1024 + 1),
			}],
		})).toThrow(/too large/i);
	});

	it("rejects a message whose encoded estimate exceeds the portable limit", () => {
		expect(() => validateOutboundAttachments({
			subject: "x",
			text: "x".repeat(4_718_593),
			attachments: [],
		})).toThrow(/too large/i);
	});
});

describe("decodeBase64Attachment", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("decodes canonical base64", () => {
		expect(new Uint8Array(decodeBase64Attachment("aGVsbG8="))).toEqual(
			new TextEncoder().encode("hello"),
		);
	});

	it.each(["%%%", "a", "aGVsbG8"])("rejects malformed base64", (value) => {
		expect(() => decodeBase64Attachment(value)).toThrow(/Base64/);
	});

	it("normalizes a decoder runtime failure", () => {
		vi.stubGlobal("atob", () => { throw new Error("decoder failure"); });
		expect(() => decodeBase64Attachment("aGVsbG8=")).toThrow(/Base64/);
	});
});
