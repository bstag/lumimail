import { describe, expect, it } from "vitest";
import {
	getContactId,
	getContactNameFromAddress,
	getDisplayNameForAddress,
} from "@/lib/contacts/utils";

describe("getContactId", () => {
	it("combines userId with a normalized email", () => {
		expect(getContactId("usr_1", "  Maya@Acme.test ")).toBe("usr_1:maya@acme.test");
	});
});

describe("getContactNameFromAddress", () => {
	it("returns the display name when present and distinct from the address", () => {
		expect(getContactNameFromAddress('"Maya Chen" <maya@acme.test>')).toBe("Maya Chen");
	});

	it("returns null when there is no display name", () => {
		expect(getContactNameFromAddress("maya@acme.test")).toBeNull();
	});

	it("returns null when the display name equals the address", () => {
		expect(getContactNameFromAddress('"maya@acme.test" <maya@acme.test>')).toBeNull();
	});
});

describe("getDisplayNameForAddress", () => {
	it("prefers a non-empty contact name", () => {
		expect(getDisplayNameForAddress("maya@acme.test", "  Maya  ")).toBe("Maya");
	});

	it("falls back to the derived display name when the contact name is blank", () => {
		expect(getDisplayNameForAddress('"Maya Chen" <maya@acme.test>', "   ")).toBe("Maya Chen");
	});

	it("falls back to the derived display name when no contact name is given", () => {
		expect(getDisplayNameForAddress("maya@acme.test")).toBe("maya");
		expect(getDisplayNameForAddress("maya@acme.test", null)).toBe("maya");
	});
});
