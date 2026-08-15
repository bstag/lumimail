import { describe, expect, it } from "vitest";
import { buildOAuthAuthorizationRequest, isSameOriginMutation } from "@/lib/mcp/authorization-request";

describe("MCP browser authorization request", () => {
	it("reconstructs only a bounded query on the configured authorization endpoint", () => {
		expect(buildOAuthAuthorizationRequest("https://mail.example/", "?client_id=a&state=b").url)
			.toBe("https://mail.example/oauth/authorize?client_id=a&state=b");
		for (const query of ["client_id=a", `?${"x".repeat(4096)}`, "?client_id=a#fragment"]) {
			expect(() => buildOAuthAuthorizationRequest("https://mail.example", query)).toThrow("Invalid authorization request");
		}
	});

	it("requires both the request URL and browser Origin to match the configured origin", () => {
		expect(isSameOriginMutation(new Request("https://mail.example/api/mcp/authorization", {
			headers: { origin: "https://mail.example" },
		}), "https://mail.example")).toBe(true);
		expect(isSameOriginMutation(new Request("https://mail.example/api/mcp/authorization"), "https://mail.example")).toBe(false);
		expect(isSameOriginMutation(new Request("https://evil.example/api/mcp/authorization", {
			headers: { origin: "https://mail.example" },
		}), "https://mail.example")).toBe(false);
	});
});
