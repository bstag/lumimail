import { describe, expect, it } from "vitest";
import {
	canSubmitRoutingRule,
	filterMailboxesByDomain,
	readRoutingResponse,
	sortRoutingRules,
} from "@/app/(admin)/routing/utils";

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

	it("returns successful raw responses and exposes safe API errors", async () => {
		await expect(readRoutingResponse<{ id: string }>(new Response(JSON.stringify({ id: "r1" }), { status: 200 })))
			.resolves.toEqual({ id: "r1" });
		await expect(readRoutingResponse(new Response(JSON.stringify({ error: "Provider conflict" }), { status: 409 })))
			.rejects.toThrow("Provider conflict");
		await expect(readRoutingResponse(new Response("not-json", { status: 500 })))
			.rejects.toThrow("Routing request failed");
		await expect(readRoutingResponse(new Response(JSON.stringify(null), { status: 500 })))
			.rejects.toThrow("Routing request failed");
		await expect(readRoutingResponse(new Response(JSON.stringify({ error: { detail: "hidden" } }), { status: 500 })))
			.rejects.toThrow("Routing request failed");
	});

	it("reads the canonical envelope on both success and failure", async () => {
		// Unwrapped so callers keep receiving the payload directly.
		await expect(
			readRoutingResponse<{ rules: string[] }>(
				new Response(JSON.stringify({ success: true, data: { rules: ["r1"] } }), { status: 200 }),
			),
		).resolves.toEqual({ rules: ["r1"] });

		// The specific reason must survive. Reading `error` as a string here is what
		// previously reduced every enveloped failure to a generic message.
		await expect(
			readRoutingResponse(
				new Response(
					JSON.stringify({ success: false, error: { message: "Register this forwarding destination before using it" } }),
					{ status: 422 },
				),
			),
		).rejects.toThrow("Register this forwarding destination before using it");
	});

	it("still understands the bare error string guardUser returns", async () => {
		await expect(
			readRoutingResponse(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
		).rejects.toThrow("Unauthorized");
	});

	it("falls back when error.message is present but not a string", async () => {
		await expect(
			readRoutingResponse(
				new Response(JSON.stringify({ success: false, error: { message: 42 } }), { status: 500 }),
			),
		).rejects.toThrow("Routing request failed");
	});
});
