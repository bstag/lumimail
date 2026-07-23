import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import {
	canMailboxSend,
	clearMailboxesCache,
	fetchMailboxOptions,
	findSendCapableMailbox,
} from "@/components/mailbox-provider-utils";

function jsonResponse(body: unknown) {
	return { json: async () => body } as unknown as Response;
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
	clearMailboxesCache();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("fetchMailboxOptions", () => {
	it("fetches, maps, and caches the mailbox options", async () => {
		authFetch.mockResolvedValue(jsonResponse({ mailboxes: [rawMailbox] }));

		const result = await fetchMailboxOptions();

		expect(result).toEqual([mappedMailbox]);
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes");
	});

	it("defaults to an empty list when the response has no mailboxes", async () => {
		authFetch.mockResolvedValue(jsonResponse({}));
		await expect(fetchMailboxOptions()).resolves.toEqual([]);
	});

	it("returns the cached value on subsequent calls without fetching again", async () => {
		authFetch.mockResolvedValue(jsonResponse({ mailboxes: [rawMailbox] }));

		await fetchMailboxOptions();
		const second = await fetchMailboxOptions();

		expect(second).toEqual([mappedMailbox]);
		expect(authFetch).toHaveBeenCalledTimes(1);
	});

	it("reuses the in-flight request when called again before it resolves", async () => {
		let resolveFetch!: (value: Response) => void;
		authFetch.mockReturnValue(
			new Promise<Response>((resolve) => {
				resolveFetch = resolve;
			}),
		);

		const first = fetchMailboxOptions();
		const second = fetchMailboxOptions();

		resolveFetch(jsonResponse({ mailboxes: [rawMailbox] }));

		const [a, b] = await Promise.all([first, second]);
		expect(a).toEqual([mappedMailbox]);
		expect(b).toEqual([mappedMailbox]);
		expect(authFetch).toHaveBeenCalledTimes(1);
	});

	it("bypasses the cache when force is true", async () => {
		authFetch.mockResolvedValue(jsonResponse({ mailboxes: [rawMailbox] }));

		await fetchMailboxOptions();
		await fetchMailboxOptions(true);

		expect(authFetch).toHaveBeenCalledTimes(2);
	});

	it("clears the in-flight request after completion so later calls refetch", async () => {
		authFetch.mockResolvedValue(jsonResponse({ mailboxes: [rawMailbox] }));
		await fetchMailboxOptions();

		clearMailboxesCache();
		await fetchMailboxOptions();

		expect(authFetch).toHaveBeenCalledTimes(2);
	});
});

describe("clearMailboxesCache", () => {
	it("forces a refetch after clearing", async () => {
		authFetch.mockResolvedValue(jsonResponse({ mailboxes: [rawMailbox] }));
		await fetchMailboxOptions();
		clearMailboxesCache();
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
