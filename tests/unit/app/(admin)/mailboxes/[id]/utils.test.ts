import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { fetchMailbox, getMailboxAddress, updateMailboxName } from "@/app/(admin)/mailboxes/[id]/utils";

function jsonResponse(ok: boolean, body: unknown) {
	return { ok, json: async () => body } as unknown as Response;
}

beforeEach(() => {
	authFetch.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("getMailboxAddress", () => {
	it("re-exports the address builder", () => {
		expect(getMailboxAddress({ localPart: "bob", hostname: "example.com" })).toBe("bob@example.com");
	});
});

describe("fetchMailbox", () => {
	it("returns the mailbox on success", async () => {
		const mailbox = { id: "mb_1" };
		authFetch.mockResolvedValue(jsonResponse(true, { mailbox }));
		await expect(fetchMailbox("mb_1")).resolves.toBe(mailbox);
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes/mb_1");
	});

	it("throws the server error when the response is not ok", async () => {
		authFetch.mockResolvedValue(jsonResponse(false, { error: "nope" }));
		await expect(fetchMailbox("mb_1")).rejects.toThrow("nope");
	});

	it("throws when the mailbox is missing", async () => {
		authFetch.mockResolvedValue(jsonResponse(true, {}));
		await expect(fetchMailbox("mb_1")).rejects.toThrow("Failed to load mailbox");
	});

	it("falls back to the default message when no error is provided", async () => {
		authFetch.mockResolvedValue(jsonResponse(false, {}));
		await expect(fetchMailbox("mb_1")).rejects.toThrow("Failed to load mailbox");
	});
});

describe("updateMailboxName", () => {
	it("returns the updated mailbox on success", async () => {
		const mailbox = { id: "mb_2" };
		authFetch.mockResolvedValue(jsonResponse(true, { mailbox }));
		await expect(updateMailboxName("mb_2", "New Name")).resolves.toBe(mailbox);
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes/mb_2", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ displayName: "New Name" }),
		});
	});

	it("throws the server error when the response is not ok", async () => {
		authFetch.mockResolvedValue(jsonResponse(false, { error: "bad" }));
		await expect(updateMailboxName("mb_2", "x")).rejects.toThrow("bad");
	});

	it("throws when the mailbox is missing", async () => {
		authFetch.mockResolvedValue(jsonResponse(true, {}));
		await expect(updateMailboxName("mb_2", "x")).rejects.toThrow("Failed to update mailbox");
	});

	it("falls back to the default message when no error is provided", async () => {
		authFetch.mockResolvedValue(jsonResponse(false, {}));
		await expect(updateMailboxName("mb_2", "x")).rejects.toThrow("Failed to update mailbox");
	});
});
