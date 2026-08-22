import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import {
	fetchMessageCounts,
	fetchMessageList,
	getMessageQueryParams,
	parseMessageSearchQuery,
} from "@/hooks/utils";

function jsonResponse(body: unknown) {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function envelope(data: unknown) {
	return jsonResponse({ success: true, data });
}

beforeEach(() => {
	authFetch.mockReset();
});

// These are plain fetchers now: caching, dedupe, and account-switch isolation
// belong to TanStack Query (T-34/F50). Each call must hit the network.
describe("fetchMessageList", () => {
	it("requests the list with the given params and returns the payload", async () => {
		const payload = { messages: [{ id: "msg_1" }], total: 1, limit: 25, offset: 0 };
		authFetch.mockResolvedValue(envelope(payload));

		const params = new URLSearchParams("status=received");
		await expect(fetchMessageList(params)).resolves.toEqual(payload);
		expect(authFetch).toHaveBeenCalledWith("/api/messages?status=received", { method: "GET" });
	});

	it("fetches fresh on every call", async () => {
		authFetch.mockResolvedValue(envelope({ messages: [] }));

		const params = new URLSearchParams("status=received");
		await fetchMessageList(params);
		await fetchMessageList(params);

		expect(authFetch).toHaveBeenCalledTimes(2);
	});
});

describe("fetchMessageCounts", () => {
	it("scopes the request to a mailbox when one is given", async () => {
		const counts = { folders: { inbox: { total: 1, unread: 1 } }, mailboxes: [] };
		authFetch.mockResolvedValue(envelope({ counts }));

		await expect(fetchMessageCounts("mb_1")).resolves.toEqual(counts);
		expect(authFetch).toHaveBeenCalledWith("/api/messages/counts?mailboxId=mb_1", { method: "GET" });
	});

	it("requests the unscoped counts without a query string", async () => {
		const counts = { folders: { inbox: { total: 0, unread: 0 } }, mailboxes: [] };
		authFetch.mockResolvedValue(envelope({ counts }));

		await expect(fetchMessageCounts()).resolves.toEqual(counts);
		expect(authFetch).toHaveBeenCalledWith("/api/messages/counts", { method: "GET" });
	});

	it("returns undefined when the payload has no counts", async () => {
		authFetch.mockResolvedValue(envelope({}));
		await expect(fetchMessageCounts(null)).resolves.toBeUndefined();
	});
});

describe("parseMessageSearchQuery", () => {
	it("extracts quoted and unquoted title filters", () => {
		expect(parseMessageSearchQuery('before title:"Quarterly Report" after')).toEqual({
			title: "Quarterly Report",
			query: "before after",
		});
		expect(parseMessageSearchQuery("title:Invoice remaining")).toEqual({
			title: "Invoice",
			query: "remaining",
		});
	});

	it("extracts read state and normalizes remaining text", () => {
		expect(parseMessageSearchQuery("  alpha   :unread beta ")).toEqual({
			read: "unread",
			query: "alpha beta",
		});
		expect(parseMessageSearchQuery(":read")).toEqual({ read: "read" });
		expect(parseMessageSearchQuery("plain words")).toEqual({ query: "plain words" });
		expect(parseMessageSearchQuery("   ")).toEqual({});
	});
});

describe("getMessageQueryParams", () => {
	it.each([
		["inbox", "direction=inbound&status=received"],
		["sent", "direction=outbound&status=queued%2Csent%2Cfailed"],
		["drafts", "direction=outbound&status=draft"],
		["trash", "status=trash"],
		["spam", "status=spam"],
		["archived", "status=archived"],
		["starred", "starred=true"],
	] as const)("maps the %s folder", (folder, expected) => {
		expect(getMessageQueryParams(folder).toString()).toBe(expected);
	});

	it("combines parsed search filters, pagination, label, and mailbox scope", () => {
		const params = getMessageQueryParams("label", "mb_1", {
			query: 'words title:"Exact" :unread',
			title: "ignored by parsed title",
			read: "all",
			limit: 25,
			offset: 50,
			labelId: "lbl_1",
		});

		expect(params.get("mailboxId")).toBe("mb_1");
		expect(params.get("q")).toBe("words");
		expect(params.get("title")).toBe("Exact");
		expect(params.get("read")).toBe("unread");
		expect(params.get("limit")).toBe("25");
		expect(params.get("offset")).toBe("50");
		expect(params.get("labelId")).toBe("lbl_1");
	});

	it("omits empty and default filters", () => {
		const params = getMessageQueryParams("inbox", null, {
			query: " ", title: " ", read: "all", limit: 0, offset: 0,
		});
		expect(params.has("mailboxId")).toBe(false);
		expect(params.has("q")).toBe(false);
		expect(params.has("title")).toBe(false);
		expect(params.has("read")).toBe(false);
		expect(params.has("limit")).toBe(false);
		expect(params.has("offset")).toBe(false);
	});
});
