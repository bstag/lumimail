import { describe, expect, it } from "vitest";
import { getZoneLookupCandidates, isZoneApex } from "@/lib/domains/utils";

describe("getZoneLookupCandidates", () => {
	it("returns progressively shorter parent domains", () => {
		expect(getZoneLookupCandidates("mail.team.example.com")).toEqual([
			"mail.team.example.com",
			"team.example.com",
			"example.com",
		]);
	});

	it("returns the apex for a two-label hostname", () => {
		expect(getZoneLookupCandidates("example.com")).toEqual(["example.com"]);
	});

	it("ignores empty labels from stray dots", () => {
		expect(getZoneLookupCandidates("example.com.")).toEqual(["example.com"]);
	});

	it("returns no candidates for a single label", () => {
		expect(getZoneLookupCandidates("localhost")).toEqual([]);
	});
});

describe("isZoneApex", () => {
	it("is true when hostname equals the zone name", () => {
		expect(isZoneApex("example.com", "example.com")).toBe(true);
	});

	it("is false for a subdomain", () => {
		expect(isZoneApex("mail.example.com", "example.com")).toBe(false);
	});
});
