import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import {
	canMailboxSend,
	fetchMailboxOptions,
	findSendCapableMailbox,
} from "@/components/mailbox-provider-utils";

function jsonResponse(body: unknown) {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function envelope(data: unknown) {
	return jsonResponse({ success: true, data });
}

const rawMailbox = {
	id: "mb_1",
	localPart: "alice",
	hostname: "example.com",
	displayName: "Alice",
	role: "responder",
	isPrimary: true,
	extra: "dropped",
};

const mappedMailbox = {
	id: "mb_1",
	localPart: "alice",
	hostname: "example.com",
	displayName: "Alice",
	role: "responder",
	isPrimary: true,
};

beforeEach(() => {
	authFetch.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// Caching, request dedupe, and account-switch isolation moved to TanStack
// Query (T-34/F50): the provider runs this fetcher under `mailboxKeys.user`
// and the root QueryClient clears on account reset. The fetcher itself is a
// plain fetch-and-map.
describe("fetchMailboxOptions", () => {
	it("fetches and maps the mailbox options", async () => {
		authFetch.mockResolvedValue(envelope({ mailboxes: [rawMailbox] }));

		const result = await fetchMailboxOptions();

		expect(result).toEqual([mappedMailbox]);
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes", { method: "GET" });
	});

	it("defaults to an empty list when the response has no mailboxes", async () => {
		authFetch.mockResolvedValue(envelope({}));
		await expect(fetchMailboxOptions()).resolves.toEqual([]);
	});

	it("fetches fresh on every call — TanStack owns caching now", async () => {
		authFetch.mockResolvedValue(envelope({ mailboxes: [rawMailbox] }));

		await fetchMailboxOptions();
		await fetchMailboxOptions();

		expect(authFetch).toHaveBeenCalledTimes(2);
	});
});

describe("mailbox send capabilities", () => {
	it.each([
		["viewer", false],
		["responder", true],
		["manager", true],
	] as const)("maps %s to send capability %s", (role, expected) => {
		expect(canMailboxSend({ ...mappedMailbox, role })).toBe(expected);
	});

	it("returns false without a mailbox", () => {
		expect(canMailboxSend(null)).toBe(false);
	});

	it("finds the first responder or manager mailbox", () => {
		const mailboxes = [
			{ ...mappedMailbox, id: "viewer", role: "viewer" as const },
			{ ...mappedMailbox, id: "responder", role: "responder" as const },
			{ ...mappedMailbox, id: "manager", role: "manager" as const },
		];
		expect(findSendCapableMailbox(mailboxes)?.id).toBe("responder");
	});

	it("returns undefined for a viewer-only mailbox list", () => {
		expect(
			findSendCapableMailbox([{ ...mappedMailbox, role: "viewer" }]),
		).toBeUndefined();
	});
});
