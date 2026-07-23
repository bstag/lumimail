import { describe, expect, it } from "vitest";
import { normalizeRoutingPattern } from "@/lib/email/routing-pattern";

describe("normalizeRoutingPattern", () => {
	it.each(["*", " *@Example.COM "])("normalizes %s to the canonical catch-all", (pattern) => {
		expect(normalizeRoutingPattern(pattern, "example.com")).toEqual({ ok: true, pattern: "*" });
	});

	it("normalizes local parts and exact addresses", () => {
		expect(normalizeRoutingPattern(" Support ", "example.com")).toEqual({ ok: true, pattern: "support" });
		expect(normalizeRoutingPattern(" Admin@Example.COM ", "example.com")).toEqual({
			ok: true,
			pattern: "admin@example.com",
		});
	});

	it.each([
		["*@other.com", "Catch-all domain must match the selected domain"],
		["sales@other.com", "Address domain must match the selected domain"],
		["bad local@example.com", "Enter a local part, full address, or *"],
		["foo*", "Unsupported wildcard pattern"],
		["", "Pattern is required"],
		["two words", "Enter a local part, full address, or *"],
	])("rejects %s", (pattern, error) => {
		expect(normalizeRoutingPattern(pattern, "example.com")).toEqual({ ok: false, error });
	});
});
