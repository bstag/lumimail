import { describe, expect, it } from "vitest";
import {
	INBOUND_ATTACHMENT_OMISSION_MESSAGE,
	prepareInboundAttachments,
} from "@/lib/email/inbound-attachments";
import type { ParsedAttachment } from "@/lib/email/parse";

function attachment(
	content: ArrayBuffer,
	overrides: Partial<ParsedAttachment> = {},
): ParsedAttachment {
	return {
		filename: "report.txt",
		contentType: "text/plain",
		disposition: "attachment",
		contentId: null,
		content,
		...overrides,
	};
}

describe("prepareInboundAttachments", () => {
	it("returns none for a message without attachments", () => {
		expect(prepareInboundAttachments([])).toEqual({
			status: "none",
			error: null,
			attachments: [],
		});
	});

	it("normalizes unsafe metadata without changing exact bytes", () => {
		const content = new Uint8Array([0, 1, 254, 255]).buffer;
		const result = prepareInboundAttachments([
			attachment(content, {
				filename: "../folder/\u0000invoice.html",
				contentType: " TEXT/HTML ",
			}),
			attachment(new ArrayBuffer(0), {
				filename: null,
				contentType: "",
			}),
		]);

		expect(result.status).toBe("stored");
		expect(result.error).toBeNull();
		expect(result.attachments).toHaveLength(2);
		expect(result.attachments[0]).toMatchObject({
			filename: "invoice.html",
			contentType: "text/html",
			size: 4,
		});
		expect(new Uint8Array(result.attachments[0].content)).toEqual(
			new Uint8Array([0, 1, 254, 255]),
		);
		expect(result.attachments[1]).toMatchObject({
			filename: "attachment",
			contentType: "application/octet-stream",
			size: 0,
		});
	});

	it("keeps duplicate filenames as independent attachments", () => {
		const result = prepareInboundAttachments([
			attachment(new Uint8Array([1]).buffer),
			attachment(new Uint8Array([2]).buffer),
		]);
		expect(result.attachments.map((item) => item.filename)).toEqual([
			"report.txt",
			"report.txt",
		]);
	});

	it("keeps valid inline-image metadata and demotes invalid inline parts", () => {
		const result = prepareInboundAttachments([
			attachment(new ArrayBuffer(1), {
				filename: "chart.png",
				contentType: "image/png",
				disposition: "inline",
				contentId: "<chart_1>",
			}),
			attachment(new ArrayBuffer(1), {
				contentType: "text/plain",
				disposition: "inline",
				contentId: "../bad",
			}),
			attachment(new ArrayBuffer(1), {
				contentType: "image/png",
				disposition: "inline",
				contentId: null,
			}),
		]);
		expect(result.attachments).toEqual([
			expect.objectContaining({ disposition: "inline", contentId: "chart_1" }),
			expect.objectContaining({ disposition: "attachment", contentId: null }),
			expect.objectContaining({ disposition: "attachment", contentId: null }),
		]);
	});

	it("omits the whole set when the count limit is exceeded", () => {
		const values = Array.from({ length: 51 }, () =>
			attachment(new ArrayBuffer(0)),
		);
		expect(prepareInboundAttachments(values)).toEqual({
			status: "omitted",
			error: INBOUND_ATTACHMENT_OMISSION_MESSAGE,
			attachments: [],
		});
	});

	it("omits the whole set when one file or the aggregate exceeds 25 MiB", () => {
		const tooLarge = attachment(new ArrayBuffer(25 * 1024 * 1024 + 1));
		expect(prepareInboundAttachments([tooLarge])).toMatchObject({
			status: "omitted",
			attachments: [],
		});

		const aggregate = [
			attachment(new ArrayBuffer(13 * 1024 * 1024)),
			attachment(new ArrayBuffer(13 * 1024 * 1024)),
		];
		expect(prepareInboundAttachments(aggregate)).toMatchObject({
			status: "omitted",
			error: INBOUND_ATTACHMENT_OMISSION_MESSAGE,
			attachments: [],
		});
	});
});
