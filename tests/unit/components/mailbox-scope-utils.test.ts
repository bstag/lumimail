import { describe, expect, it } from "vitest";
import {
	isAllScopeAvailable,
	readStoredAllScope,
	resolveReplyMailboxId,
	resolveScopedMailboxId,
} from "@/components/mailbox-scope-utils";
import type { MailboxOption } from "@/components/mailbox-provider";

const mailbox = (id: string): MailboxOption => ({
	id,
	localPart: id,
	hostname: "example.com",
	displayName: null,
	role: "manager",
});

describe("resolveScopedMailboxId", () => {
	it("drops the mailbox filter in all scope", () => {
		// A null mailbox id is what makes /api/messages fall back to
		// messageAccessCondition — every mailbox the caller may read.
		expect(resolveScopedMailboxId(true, "mb_1")).toBeNull();
	});

	it("keeps the active mailbox as the filter otherwise", () => {
		expect(resolveScopedMailboxId(false, "mb_1")).toBe("mb_1");
	});

	it("returns null when no mailbox has resolved yet", () => {
		expect(resolveScopedMailboxId(false, null)).toBeNull();
		expect(resolveScopedMailboxId(false, undefined)).toBeNull();
	});
});

describe("isAllScopeAvailable", () => {
	it("is offered only when there is more than one mailbox", () => {
		expect(isAllScopeAvailable(2)).toBe(true);
		expect(isAllScopeAvailable(5)).toBe(true);
		// With one mailbox the option is a no-op entry.
		expect(isAllScopeAvailable(1)).toBe(false);
		expect(isAllScopeAvailable(0)).toBe(false);
	});
});

describe("readStoredAllScope", () => {
	it("reads the stored flag only when more than one mailbox remains", () => {
		expect(readStoredAllScope("1", 3)).toBe(true);
		// A user who dropped to one mailbox must not be stranded in a scope the
		// selector no longer offers.
		expect(readStoredAllScope("1", 1)).toBe(false);
	});

	it("treats anything else as not-all", () => {
		expect(readStoredAllScope(null, 3)).toBe(false);
		expect(readStoredAllScope("", 3)).toBe(false);
		expect(readStoredAllScope("0", 3)).toBe(false);
		expect(readStoredAllScope("true", 3)).toBe(false);
	});
});

describe("resolveReplyMailboxId", () => {
	const mailboxes = [mailbox("mb_support"), mailbox("mb_me")];

	it("replies from the mailbox that received the message", () => {
		// Replying to mail addressed to a shared mailbox must not go out under
		// the individual's own address.
		expect(resolveReplyMailboxId({ mailboxId: "mb_support" }, mailboxes)).toBe("mb_support");
	});

	it("falls back when the message has no mailbox", () => {
		expect(resolveReplyMailboxId({ mailboxId: null }, mailboxes)).toBeNull();
	});

	it("falls back when access to that mailbox was revoked", () => {
		expect(resolveReplyMailboxId({ mailboxId: "mb_gone" }, mailboxes)).toBeNull();
	});
});
