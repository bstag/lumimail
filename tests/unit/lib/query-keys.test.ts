import { describe, expect, it } from "vitest";
import { domainKeys, labelKeys, mailboxKeys } from "@/lib/query-keys";

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

	it("exposes a stable labels key", () => {
		expect(labelKeys.all).toEqual(["labels"]);
	});
});
