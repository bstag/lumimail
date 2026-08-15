import { describe, expect, it } from "vitest";
import {
	canSubmitRoutingRule,
	filterMailboxesByDomain,
	sortRoutingRules,
} from "@/app/(settings)/(org)/routing/utils";

// Response-parsing coverage (envelope unwrapping, bare `{ error: "..." }`
// tolerance) moved to tests/unit/lib/api/client-response.test.ts when
// readRoutingResponse was folded into parseApiResponse/apiJson (T-22).

describe("routing UI utilities", () => {
	it("filters target mailboxes to the selected domain", () => {
		const rows = [
			{ id: "a", domainId: "d1" },
			{ id: "b", domainId: "d2" },
		];
		expect(filterMailboxesByDomain(rows, "d1")).toEqual([{ id: "a", domainId: "d1" }]);
		expect(filterMailboxesByDomain(rows, "")).toEqual([]);
	});

	it("requires the target appropriate to each action", () => {
		const base = { domainId: "d1", pattern: "*", mailboxId: "", forwardTo: "" };
		expect(canSubmitRoutingRule({ ...base, pattern: "   ", action: "reject" })).toBe(false);
		expect(canSubmitRoutingRule({ ...base, action: "store" })).toBe(false);
		expect(canSubmitRoutingRule({ ...base, action: "store", mailboxId: "m1" })).toBe(true);
		expect(canSubmitRoutingRule({ ...base, action: "forward" })).toBe(false);
		expect(canSubmitRoutingRule({ ...base, action: "forward", forwardTo: "x@y.test" })).toBe(true);
		expect(canSubmitRoutingRule({ ...base, action: "reject" })).toBe(true);
	});

	it("sorts exact, local, and catch-all rules by specificity then descending priority", () => {
		const rows = [
			{ id: "wild", pattern: "*", priority: 100 },
			{ id: "local-low", pattern: "admin", priority: 1 },
			{ id: "exact", pattern: "admin@x.test", priority: 0 },
			{ id: "local-high", pattern: "sales", priority: 10 },
		];
		expect(sortRoutingRules(rows).map((row) => row.id)).toEqual([
			"exact",
			"local-high",
			"local-low",
			"wild",
		]);
	});
});
