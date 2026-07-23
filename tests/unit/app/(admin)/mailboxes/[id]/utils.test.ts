import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import {
	addMailboxMember,
	deleteMailbox,
	fetchMailbox,
	fetchMailboxMembers,
	getMailboxAddress,
	removeMailboxMember,
	updateMailboxMemberRole,
	updateMailboxName,
} from "@/app/(admin)/mailboxes/[id]/utils";

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

describe("deleteMailbox", () => {
	it("sends the exact address confirmation", async () => {
		authFetch.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);

		await expect(deleteMailbox("mbx_1", "support@example.com")).resolves.toEqual({
			ok: true,
		});
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes/mbx_1", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmAddress: "support@example.com" }),
		});
	});

	it("surfaces a deletion error", async () => {
		authFetch.mockResolvedValue(
			new Response(JSON.stringify({ error: "Address confirmation does not match" }), {
				status: 400,
			}),
		);

		await expect(deleteMailbox("mbx_1", "wrong@example.com")).rejects.toThrow(
			"Address confirmation does not match",
		);
	});

	it("uses a fallback deletion error when the server omits one", async () => {
		authFetch.mockResolvedValue(
			new Response(JSON.stringify({}), { status: 500 }),
		);

		await expect(deleteMailbox("mbx_1", "support@example.com")).rejects.toThrow(
			"Failed to delete mailbox",
		);
	});
});

describe("mailbox membership requests", () => {
	it("loads members and available workspace members", async () => {
		const data = { members: [{ id: "mbm_1" }], workspaceMembers: [{ userId: "usr_2" }] };
		authFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
		await expect(fetchMailboxMembers("mbx_1")).resolves.toEqual(data);
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes/mbx_1/members");
	});

	it("adds a member with a mailbox role", async () => {
		authFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { id: "mbm_2" } }), { status: 200 }));
		await addMailboxMember("mbx_1", "usr_2", "responder");
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes/mbx_1/members", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId: "usr_2", role: "responder" }),
		});
	});

	it("updates a mailbox role", async () => {
		authFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { id: "mbm_2", role: "viewer" } }), { status: 200 }));
		await updateMailboxMemberRole("mbx_1", "mbm_2", "viewer");
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes/mbx_1/members/mbm_2", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ role: "viewer" }),
		});
	});

	it("removes a mailbox member", async () => {
		authFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }));
		await removeMailboxMember("mbx_1", "mbm_2");
		expect(authFetch).toHaveBeenCalledWith("/api/mailboxes/mbx_1/members/mbm_2", { method: "DELETE" });
	});
});
