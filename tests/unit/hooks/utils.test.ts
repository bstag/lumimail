import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import {
	fetchMessageCounts,
	fetchMessageList,
} from "@/hooks/utils";
import { resetAccountScopedClientState } from "@/lib/auth/account-state";

function jsonResponse(body: unknown) {
	return { json: async () => body } as unknown as Response;
}

beforeEach(() => {
	authFetch.mockReset();
	resetAccountScopedClientState();
});

describe("account-scoped message caches", () => {
	it("does not let an old message-list request replace or delete the new account request", async () => {
		let resolveOld!: (value: Response) => void;
		const oldMessages = { messages: [{ id: "old" }], total: 1 };
		const newMessages = { messages: [{ id: "new" }], total: 1 };
		authFetch
			.mockReturnValueOnce(new Promise<Response>((resolve) => {
				resolveOld = resolve;
			}))
			.mockResolvedValueOnce(jsonResponse(newMessages));
		const params = new URLSearchParams("status=received");

		const oldRequest = fetchMessageList(params);
		resetAccountScopedClientState();
		const currentRequest = fetchMessageList(params);

		await expect(currentRequest).resolves.toEqual(newMessages);
		resolveOld(jsonResponse(oldMessages));
		await expect(oldRequest).resolves.toEqual(oldMessages);
		await expect(fetchMessageList(params)).resolves.toEqual(newMessages);
		expect(authFetch).toHaveBeenCalledTimes(2);
	});

	it("does not let an old count request replace or delete the new account request", async () => {
		let resolveOld!: (value: Response) => void;
		const oldCounts = { folders: { inbox: { total: 9, unread: 9 } }, mailboxes: [] };
		const newCounts = { folders: { inbox: { total: 1, unread: 0 } }, mailboxes: [] };
		authFetch
			.mockReturnValueOnce(new Promise<Response>((resolve) => {
				resolveOld = resolve;
			}))
			.mockResolvedValueOnce(jsonResponse({ counts: newCounts }));

		const oldRequest = fetchMessageCounts();
		resetAccountScopedClientState();
		const currentRequest = fetchMessageCounts();

		await expect(currentRequest).resolves.toEqual(newCounts);
		resolveOld(jsonResponse({ counts: oldCounts }));
		await expect(oldRequest).resolves.toEqual(oldCounts);
		await expect(fetchMessageCounts()).resolves.toEqual(newCounts);
		expect(authFetch).toHaveBeenCalledTimes(2);
	});
});
