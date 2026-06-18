import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/hooks/types";

const authFetch = vi.fn();
const getEmailAddress = vi.fn();
const getDisplayNameForAddress = vi.fn();
const htmlToReadableText = vi.fn();
const splitRepliedEmailContent = vi.fn();

vi.mock("@/lib/auth/client", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock("@/lib/email/address", () => ({ getEmailAddress: (...a: unknown[]) => getEmailAddress(...a) }));
vi.mock("@/lib/contacts/utils", () => ({
	getDisplayNameForAddress: (...a: unknown[]) => getDisplayNameForAddress(...a),
}));
vi.mock("@/lib/email/reply-content-utils", () => ({
	htmlToReadableText: (...a: unknown[]) => htmlToReadableText(...a),
	splitRepliedEmailContent: (...a: unknown[]) => splitRepliedEmailContent(...a),
}));

import {
	fetchMessageDetail,
	getMessageBodyDisplay,
	getMessageHeaderParties,
} from "@/app/(dashboard)/inbox/[messageId]/utils";

beforeEach(() => {
	authFetch.mockReset();
	getEmailAddress.mockReset();
	getDisplayNameForAddress.mockReset();
	htmlToReadableText.mockReset();
	splitRepliedEmailContent.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("fetchMessageDetail", () => {
	it("fetches and returns the parsed JSON body", async () => {
		const body = { message: { id: "m1" } };
		authFetch.mockResolvedValue({ json: async () => body } as unknown as Response);
		await expect(fetchMessageDetail("m1")).resolves.toBe(body);
		expect(authFetch).toHaveBeenCalledWith("/api/messages/m1");
	});
});

describe("getMessageHeaderParties", () => {
	it("derives names and address from helpers", () => {
		getDisplayNameForAddress.mockReturnValueOnce("From Name").mockReturnValueOnce("To Name");
		getEmailAddress.mockReturnValue("from@example.com");
		const message = {
			fromAddr: "From <from@example.com>",
			fromContactName: "FC",
			toAddr: "to@example.com",
			toContactName: "TC",
		} as unknown as Message;

		expect(getMessageHeaderParties(message)).toEqual({
			fromName: "From Name",
			fromAddress: "from@example.com",
			toName: "To Name",
		});
		expect(getDisplayNameForAddress).toHaveBeenNthCalledWith(1, "From <from@example.com>", "FC");
		expect(getDisplayNameForAddress).toHaveBeenNthCalledWith(2, "to@example.com", "TC");
		expect(getEmailAddress).toHaveBeenCalledWith("From <from@example.com>");
	});
});

describe("getMessageBodyDisplay", () => {
	it("uses the text body directly when provided", () => {
		splitRepliedEmailContent.mockReturnValue({ latestContent: "hi", quotedContent: [] });
		const result = getMessageBodyDisplay("plain text", "<p>html</p>", "fallback");
		expect(splitRepliedEmailContent).toHaveBeenCalledWith("plain text");
		expect(htmlToReadableText).not.toHaveBeenCalled();
		expect(result).toEqual({
			latestContent: "hi",
			quotedContent: [],
			htmlBody: "<p>html</p>",
			hasQuotedContent: false,
		});
	});

	it("falls back to readable text from html when text body is nullish", () => {
		htmlToReadableText.mockReturnValue("readable");
		splitRepliedEmailContent.mockReturnValue({ latestContent: "readable", quotedContent: [] });
		const result = getMessageBodyDisplay(null, "<p>html</p>", "fallback");
		expect(htmlToReadableText).toHaveBeenCalledWith("<p>html</p>");
		expect(splitRepliedEmailContent).toHaveBeenCalledWith("readable");
		expect(result.htmlBody).toBe("<p>html</p>");
		expect(result.hasQuotedContent).toBe(false);
	});

	it("falls back to the fallback string when html yields empty text", () => {
		htmlToReadableText.mockReturnValue("");
		splitRepliedEmailContent.mockReturnValue({ latestContent: "fb", quotedContent: [] });
		getMessageBodyDisplay(undefined, "<p></p>", "fallback");
		expect(splitRepliedEmailContent).toHaveBeenCalledWith("fallback");
	});

	it("falls back to an empty string when html and fallback are empty", () => {
		htmlToReadableText.mockReturnValue("");
		splitRepliedEmailContent.mockReturnValue({ latestContent: "", quotedContent: [] });
		getMessageBodyDisplay(null, null, null);
		expect(splitRepliedEmailContent).toHaveBeenCalledWith("");
	});

	it("nulls out htmlBody and flags quoted content when quotes exist", () => {
		splitRepliedEmailContent.mockReturnValue({
			latestContent: "latest",
			quotedContent: [{ dateLine: "d", content: "c" }],
		});
		const result = getMessageBodyDisplay("text", "<p>html</p>", null);
		expect(result.htmlBody).toBeNull();
		expect(result.hasQuotedContent).toBe(true);
	});

	it("defaults htmlBody to null when no html and no quotes", () => {
		splitRepliedEmailContent.mockReturnValue({ latestContent: "latest", quotedContent: [] });
		const result = getMessageBodyDisplay("text", null, null);
		expect(result.htmlBody).toBeNull();
	});

	it("defaults htmlBody to null when html is undefined and no quotes", () => {
		splitRepliedEmailContent.mockReturnValue({ latestContent: "latest", quotedContent: [] });
		const result = getMessageBodyDisplay("text", undefined, null);
		expect(result.htmlBody).toBeNull();
	});
});
