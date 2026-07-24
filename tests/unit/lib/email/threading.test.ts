import { describe, expect, it } from "vitest";
import {
	buildReplyThreading,
	deriveMailboxThreadId,
	normalizeReferences,
	normalizeRfcMessageId,
	resolveInboundThreading,
} from "@/lib/email/threading";

describe("RFC message-id normalization", () => {
	it("accepts a bounded angle-bracket message id and rejects unsafe values", () => {
		expect(normalizeRfcMessageId(" <parent@example.com> ")).toBe("<parent@example.com>");
		expect(normalizeRfcMessageId("parent@example.com")).toBeNull();
		expect(normalizeRfcMessageId("<bad\r\nBcc: victim@example.com>")).toBeNull();
		expect(normalizeRfcMessageId(`<${"a".repeat(997)}>`)).toBeNull();
	});

	it("extracts, de-duplicates, and bounds reference tokens", () => {
		const references = [
			"<root@example.com>",
			"<middle@example.com>",
			"<root@example.com>",
			"not-an-id",
		].join(" ");
		expect(normalizeReferences(references)).toEqual([
			"<root@example.com>",
			"<middle@example.com>",
		]);
		expect(normalizeReferences("not-an-id")).toEqual([]);
		expect(normalizeReferences(`<${"x".repeat(997)}>`)).toEqual([]);
	});
});

describe("reply threading headers", () => {
	it("appends the immediate parent without duplicating existing references", () => {
		expect(buildReplyThreading({
			rfcMessageId: "<parent@example.com>",
			providerMessageId: "provider-only",
			referencesHeader: "<root@example.com> <parent@example.com>",
		})).toEqual({
			inReplyTo: "<parent@example.com>",
			referencesHeader: "<root@example.com> <parent@example.com>",
			headers: {
				"In-Reply-To": "<parent@example.com>",
				References: "<root@example.com> <parent@example.com>",
			},
		});
	});

	it("falls back to a valid provider RFC id and omits headers without one", () => {
		expect(buildReplyThreading({
			rfcMessageId: null,
			providerMessageId: "<provider@example.com>",
			referencesHeader: null,
		}).headers).toEqual({
			"In-Reply-To": "<provider@example.com>",
			References: "<provider@example.com>",
		});
		expect(buildReplyThreading({
			rfcMessageId: null,
			providerMessageId: "resend_123",
			referencesHeader: null,
		})).toEqual({
			inReplyTo: null,
			referencesHeader: null,
			headers: undefined,
		});
	});

	it("preserves the root and newest references within provider limits", () => {
		const referencesHeader = Array.from(
			{ length: 150 },
			(_, index) => `<${index}-${"x".repeat(20)}@example.com>`,
		).join(" ");
		const result = buildReplyThreading({
			rfcMessageId: "<parent@example.com>",
			providerMessageId: null,
			referencesHeader,
		});
		const tokens = normalizeReferences(result.referencesHeader);
		expect(tokens.length).toBeLessThanOrEqual(100);
		expect(tokens[0]).toBe(`<0-${"x".repeat(20)}@example.com>`);
		expect(tokens.at(-1)).toBe("<parent@example.com>");
		expect(new TextEncoder().encode(result.referencesHeader ?? "").byteLength).toBeLessThanOrEqual(2048);
	});
});

describe("mailbox thread ids", () => {
	it("is deterministic per mailbox without exposing the raw RFC id", async () => {
		const first = await deriveMailboxThreadId("mbx_one", "<root@example.com>");
		const again = await deriveMailboxThreadId("mbx_one", "<root@example.com>");
		const otherMailbox = await deriveMailboxThreadId("mbx_two", "<root@example.com>");
		expect(first).toBe(again);
		expect(first).not.toBe(otherMailbox);
		expect(first).toMatch(/^thr_[a-f0-9]{32}$/);
		expect(first).not.toContain("root@example.com");
	});

	it("inherits a known parent thread using reply candidates in priority order", async () => {
		const findAncestor = async (candidates: string[]) => {
			expect(candidates).toEqual([
				"<parent@example.com>",
				"<middle@example.com>",
				"<root@example.com>",
			]);
			return { threadId: "thr_existing" };
		};
		await expect(resolveInboundThreading({
			mailboxId: "mbx_one",
			messageId: "<child@example.com>",
			inReplyTo: "<parent@example.com>",
			references: "<root@example.com> <middle@example.com>",
			fallbackThreadId: "thr_new",
			findAncestor,
		})).resolves.toEqual({
			threadId: "thr_existing",
			rfcMessageId: "<child@example.com>",
			inReplyTo: "<parent@example.com>",
			referencesHeader: "<root@example.com> <middle@example.com>",
		});
	});

	it("uses a deterministic opaque root when no ancestor is in this mailbox", async () => {
		const result = await resolveInboundThreading({
			mailboxId: "mbx_one",
			messageId: "<child@example.com>",
			inReplyTo: "<missing@example.com>",
			references: "<root@example.com>",
			fallbackThreadId: "thr_new",
			findAncestor: async () => null,
		});
		expect(result.threadId).toBe(await deriveMailboxThreadId("mbx_one", "<root@example.com>"));
	});

	it("uses the first valid In-Reply-To token when a sender supplies several", async () => {
		const findAncestor = async (candidates: string[]) => {
			expect(candidates[0]).toBe("<first@example.com>");
			return { threadId: "thr_first" };
		};
		await expect(resolveInboundThreading({
			mailboxId: "mbx_one",
			messageId: "<child@example.com>",
			inReplyTo: "<first@example.com> <second@example.com>",
			references: null,
			fallbackThreadId: "thr_new",
			findAncestor,
		})).resolves.toMatchObject({
			threadId: "thr_first",
			inReplyTo: "<first@example.com>",
		});
	});

	it("uses a fresh opaque id when no valid RFC identity exists", async () => {
		await expect(resolveInboundThreading({
			mailboxId: "mbx_one",
			messageId: null,
			inReplyTo: null,
			references: null,
			fallbackThreadId: "thr_new",
			findAncestor: async () => {
				throw new Error("lookup should not run");
			},
		})).resolves.toMatchObject({ threadId: "thr_new" });
	});
});
