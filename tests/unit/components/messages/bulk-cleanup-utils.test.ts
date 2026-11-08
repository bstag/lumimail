// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/api/client-response", () => ({ apiJson: { post: h.post, get: h.get } }));
vi.mock("@/lib/query-keys", () => ({ invalidateMessageQueries: h.invalidate }));

import {
	BACKLOG_DISMISSED_KEY, olderThan, previewViewAction, readBacklogDismissed, runViewAction, viewQuery, writeBacklogDismissed,
} from "@/components/messages/bulk-cleanup-utils";
import {
	GROUP_BY_SENDER_KEY, fetchSenderGroups, fetchSenderMessages, readGroupBySender, subscribeGroupBySender, withSender,
	writeGroupBySender,
} from "@/components/messages/sender-groups-utils";
import type { QueryClient } from "@tanstack/react-query";

function stubStorage(store: Record<string, string> | "broken") {
	vi.stubGlobal("localStorage", store === "broken"
		? { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }
		: { getItem: (key: string) => store[key] ?? null, setItem: (key: string, value: string) => { store[key] = value; } });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("view-scoped bulk actions (F102)", () => {
	it("describes a view without paging, and narrows it by age", () => {
		const view = viewQuery("inbox", "mbx_1", { query: "deals", focus: "other", limit: 25, offset: 50 });
		expect(view).toEqual({ direction: "inbound", status: "received", mailboxId: "mbx_1", q: "deals", focus: "other" });
		expect(olderThan(view, 30)).toEqual({ ...view, olderThanDays: "30" });
	});

	it("previews and runs an action on the view, then refreshes lists", async () => {
		h.post.mockResolvedValueOnce({ matched: 4 }).mockResolvedValueOnce({ ok: true, updated: 4 });
		await expect(previewViewAction({ status: "received" }, "archive")).resolves.toBe(4);
		expect(h.post).toHaveBeenLastCalledWith("/api/messages/bulk", { action: "archive", query: { status: "received" }, preview: true });

		const client = {} as QueryClient;
		await expect(runViewAction(client, { status: "received" }, "archive")).resolves.toBe(4);
		expect(h.post).toHaveBeenLastCalledWith("/api/messages/bulk", { action: "archive", query: { status: "received" } });
		expect(h.invalidate).toHaveBeenCalledWith(client);
	});

	it("remembers dismissing the backlog prompt, tolerating blocked storage", () => {
		const store: Record<string, string> = {};
		stubStorage(store);
		expect(readBacklogDismissed()).toBe(false);
		writeBacklogDismissed();
		expect(store[BACKLOG_DISMISSED_KEY]).toBe("1");
		expect(readBacklogDismissed()).toBe(true);

		stubStorage("broken");
		expect(readBacklogDismissed()).toBe(false);
		expect(() => writeBacklogDismissed()).not.toThrow();
	});
});

describe("group by sender (F103)", () => {
	it("stores the choice, notifies this tab, and follows other tabs", () => {
		const store: Record<string, string> = {};
		stubStorage(store);
		const onChange = vi.fn();
		const unsubscribe = subscribeGroupBySender(onChange);

		writeGroupBySender(true);
		expect(store[GROUP_BY_SENDER_KEY]).toBe("1");
		expect(readGroupBySender()).toBe(true);
		expect(onChange).toHaveBeenCalledTimes(1);

		globalThis.dispatchEvent(Object.assign(new Event("storage"), { key: "other-key" }));
		expect(onChange).toHaveBeenCalledTimes(1);
		store[GROUP_BY_SENDER_KEY] = "0";
		globalThis.dispatchEvent(Object.assign(new Event("storage"), { key: GROUP_BY_SENDER_KEY }));
		expect(onChange).toHaveBeenCalledTimes(2);
		expect(readGroupBySender()).toBe(false);

		unsubscribe();
		writeGroupBySender(false);
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it("keeps working in this tab when storage is blocked", () => {
		stubStorage("broken");
		globalThis.dispatchEvent(Object.assign(new Event("storage"), { key: GROUP_BY_SENDER_KEY }));
		const unsubscribe = subscribeGroupBySender(() => {});
		globalThis.dispatchEvent(Object.assign(new Event("storage"), { key: GROUP_BY_SENDER_KEY }));
		unsubscribe();
		expect(readGroupBySender()).toBe(false);
		writeGroupBySender(true);
		expect(readGroupBySender()).toBe(true);
	});

	it("fetches groups and one sender's messages within the view", async () => {
		h.get.mockResolvedValueOnce({ total: 1, senders: [] }).mockResolvedValueOnce({ messages: [{ id: "m1" }] });
		await fetchSenderGroups({ status: "received" }, 50);
		expect(h.get).toHaveBeenLastCalledWith("/api/messages/senders?status=received&limit=50");
		await expect(fetchSenderMessages({ status: "received" }, "a@x.test")).resolves.toEqual([{ id: "m1" }]);
		expect(h.get).toHaveBeenLastCalledWith("/api/messages?status=received&sender=a%40x.test&limit=10");
		expect(withSender({ q: "x" }, "b@y.test")).toEqual({ q: "x", sender: "b@y.test" });
	});
});
