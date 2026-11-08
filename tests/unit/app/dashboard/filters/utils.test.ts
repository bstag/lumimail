import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import {
	applyFilter, bareAddress, describeFilter, fetchFilterLabels, fetchMessageFilters, filterLikeThisHref, previewFilter,
	type MessageFilter,
} from "@/app/(dashboard)/filters/utils";

beforeEach(() => authFetch.mockReset());

describe("filter page requests", () => {
	it("unwraps the filter collection", async () => {
		const filters = [{ id: "filter_1", name: "Invoices" }];
		authFetch.mockResolvedValue(Response.json({ success: true, data: { filters } }));
		await expect(fetchMessageFilters()).resolves.toEqual(filters);
	});

	it("unwraps the label array returned by the labels endpoint", async () => {
		const labels = [{ id: "label_1", name: "Finance", color: "#000000" }];
		authFetch.mockResolvedValue(Response.json({ success: true, data: labels }));
		await expect(fetchFilterLabels()).resolves.toEqual(labels);
	});
});

describe("apply to existing mail (F101)", () => {
	it("previews with GET and applies with POST", async () => {
		authFetch.mockResolvedValueOnce(Response.json({ success: true, data: { matched: 12 } }));
		await expect(previewFilter("filter_1")).resolves.toBe(12);
		expect(authFetch).toHaveBeenLastCalledWith("/api/filters/filter_1/apply", { method: "GET" });

		authFetch.mockResolvedValueOnce(Response.json({ success: true, data: { matched: 12 } }));
		await expect(applyFilter("filter_1")).resolves.toBe(12);
		expect(authFetch.mock.lastCall?.[1]).toMatchObject({ method: "POST" });
	});
});

describe("describeFilter (F101)", () => {
	const t = (key: string, values?: Record<string, string | number>) => values ? `${key}(${Object.values(values).join("|")})` : key;
	const base: MessageFilter = {
		id: "f", name: "F", fromContains: null, toContains: null, subjectContains: null, hasWords: null, matchMode: "all",
		actionStar: false, actionMarkRead: false, actionArchive: false, actionLabelId: null, actionMoveToTrash: false,
		actionFocus: null, actionExpireDays: null, enabled: true,
	};

	it("lists every condition and action", () => {
		expect(describeFilter({
			...base, fromContains: "shop", toContains: "me", subjectContains: "sale", hasWords: "deal",
			actionStar: true, actionMarkRead: true, actionArchive: true, actionMoveToTrash: true, actionLabelId: "l",
			actionFocus: "other", actionExpireDays: 7,
		}, t)).toEqual({
			ifLine: "ifPrefix(condFrom(shop), condSubject(sale), condTo(me), condWords(deal))",
			thenLine: "thenPrefix(actStar, actMarkRead, actArchive, actTrash, actLabel, actOther, actExpire(7))",
		});
	});

	it("says any-of, focused, no conditions and no action", () => {
		expect(describeFilter({ ...base, fromContains: "a", matchMode: "any", actionFocus: "focused" }, t))
			.toEqual({ ifLine: "ifAnyPrefix(condFrom(a))", thenLine: "thenPrefix(actFocused)" });
		expect(describeFilter(base, t)).toEqual({ ifLine: "noConditions", thenLine: "thenPrefix(noAction)" });
	});
});

describe("filter like this (F101)", () => {
	it("prefills the sender's bare address", () => {
		expect(bareAddress('"Shop" <Deals@Shop.test>')).toBe("deals@shop.test");
		expect(bareAddress(" plain@x.test ")).toBe("plain@x.test");
		expect(filterLikeThisHref("Shop <a+b@shop.test>")).toBe("/filters?from=a%2Bb%40shop.test");
	});
});
