import { describe, expect, it, vi } from "vitest";
import {
	domainKeys,
	invalidateMessageQueries,
	labelKeys,
	mailboxKeys,
	messageKeys,
} from "@/lib/query-keys";

describe("query keys", () => {
	it("gives the DNS and plain domain lists distinct cache keys", () => {
		expect(domainKeys.list({ includeDns: true })).not.toEqual(
			domainKeys.list({ includeDns: false }),
		);
	});

	it("keeps every domain list variant under the invalidation prefix", () => {
		for (const includeDns of [true, false]) {
			const key = domainKeys.list({ includeDns });
			expect(key.slice(0, domainKeys.all.length)).toEqual([...domainKeys.all]);
		}
	});

	it("separates user-scoped and admin-scoped mailbox lists", () => {
		expect(mailboxKeys.user).not.toEqual(mailboxKeys.admin);
	});

	it("gives the raw envelope and the mapped options distinct mailbox keys", () => {
		// Two payload shapes must never share an exact key (T-03).
		expect(mailboxKeys.options).not.toEqual(mailboxKeys.user);
		// But invalidating the user prefix must still refresh the mapped options.
		expect(mailboxKeys.options.slice(0, mailboxKeys.user.length)).toEqual([...mailboxKeys.user]);
	});

	it("exposes a stable labels key", () => {
		expect(labelKeys.all).toEqual(["labels"]);
	});

	it("keeps every message query variant under the shared invalidation prefix", () => {
		const listOptions = {
			mailboxId: "mb_1",
			query: null,
			read: null,
			title: null,
			limit: 25,
			offset: 0,
			labelId: null,
		};
		for (const key of [
			messageKeys.list("inbox", listOptions),
			messageKeys.counts("mb_1"),
			messageKeys.counts(null),
			messageKeys.detail("msg_1"),
			messageKeys.thread("thr_1"),
		]) {
			expect(key.slice(0, messageKeys.all.length)).toEqual([...messageKeys.all]);
		}
	});

	it("separates list, counts, detail, and thread namespaces", () => {
		const namespaces = [
			messageKeys.list("inbox", {
				mailboxId: null,
				query: null,
				read: null,
				title: null,
				limit: null,
				offset: null,
				labelId: null,
			})[1],
			messageKeys.counts(null)[1],
			messageKeys.detail("x")[1],
			messageKeys.thread("x")[1],
		];
		expect(new Set(namespaces).size).toBe(namespaces.length);
	});

	it("gives different pages of the same folder distinct list keys", () => {
		const base = {
			mailboxId: "mb_1",
			query: null,
			read: null,
			title: null,
			limit: 25,
			labelId: null,
		};
		expect(messageKeys.list("inbox", { ...base, offset: 0 })).not.toEqual(
			messageKeys.list("inbox", { ...base, offset: 25 }),
		);
	});
});

describe("invalidateMessageQueries", () => {
	it("invalidates the shared message prefix once", async () => {
		const queryClient = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };

		await invalidateMessageQueries(queryClient);

		expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: messageKeys.all });
	});
});
