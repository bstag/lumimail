import { describe, expect, it } from "vitest";
import { parseApiKeyScopes } from "@/app/(admin)/api-keys/utils";
import { parseScopes } from "@/lib/api-keys";

describe("parseApiKeyScopes", () => {
	it("re-exports parseScopes from @/lib/api-keys", () => {
		expect(parseApiKeyScopes).toBe(parseScopes);
	});

	it("parses a JSON array of scope strings", () => {
		expect(parseApiKeyScopes('["read","write"]')).toEqual(["read", "write"]);
	});

	it("filters out non-string entries", () => {
		expect(parseApiKeyScopes('["read",1,null,"write"]')).toEqual(["read", "write"]);
	});

	it("returns an empty array for non-array JSON", () => {
		expect(parseApiKeyScopes('{"a":1}')).toEqual([]);
	});

	it("returns an empty array for invalid JSON", () => {
		expect(parseApiKeyScopes("not json")).toEqual([]);
	});
});
