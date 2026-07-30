import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { fetchMessageCounts, fetchMessageList } from "@/hooks/utils";

function jsonResponse(body: unknown) {
	return { json: async () => body } as unknown as Response;
}

beforeEach(() => {
	authFetch.mockReset();
});

// These are plain fetchers now: caching, dedupe, and account-switch isolation
// belong to TanStack Query (T-34/F50). Each call must hit the network.
describe("fetchMessageList", () => {
	it("requests the list with the given params and returns the payload", async () => {
		const payload = { messages: [{ id: "msg_1" }], total: 1, limit: 25, offset: 0 };
		authFetch.mockResolvedValue(jsonResponse(payload));

		const params = new URLSearchParams("status=received");
		await expect(fetchMessageList(params)).resolves.toEqual(payload);
		expect(authFetch).toHaveBeenCalledWith("/api/messages?status=received");
	});

	it("fetches fresh on every call", async () => {
		authFetch.mockResolvedValue(jsonResponse({ messages: [] }));

		const params = new URLSearchParams("status=received");
		await fetchMessageList(params);
		await fetchMessageList(params);

		expect(authFetch).toHaveBeenCalledTimes(2);
	});
});

describe("fetchMessageCounts", () => {
	it("scopes the request to a mailbox when one is given", async () => {
		const counts = { folders: { inbox: { total: 1, unread: 1 } }, mailboxes: [] };
		authFetch.mockResolvedValue(jsonResponse({ counts }));

		await expect(fetchMessageCounts("mb_1")).resolves.toEqual(counts);
		expect(authFetch).toHaveBeenCalledWith("/api/messages/counts?mailboxId=mb_1");
	});

	it("requests the unscoped counts without a query string", async () => {
		const counts = { folders: { inbox: { total: 0, unread: 0 } }, mailboxes: [] };
		authFetch.mockResolvedValue(jsonResponse({ counts }));

		await expect(fetchMessageCounts()).resolves.toEqual(counts);
		expect(authFetch).toHaveBeenCalledWith("/api/messages/counts");
	});

	it("returns undefined when the payload has no counts", async () => {
		authFetch.mockResolvedValue(jsonResponse({}));
		await expect(fetchMessageCounts(null)).resolves.toBeUndefined();
	});
});
