import { describe, expect, it } from "vitest";
import {
	MCP_ACTION_SCOPE,
	MCP_READ_SCOPE,
	canonicalMcpResource,
	grantedScopesForProfile,
	hasMcpScope,
	isGrantBindingActive,
	selectConsentProfile,
} from "@/lib/mcp/security";

describe("MCP OAuth security contract", () => {
	it("derives one exact same-origin MCP resource", () => {
		expect(canonicalMcpResource("https://mail.example.com/")).toBe("https://mail.example.com/mcp");
		expect(() => canonicalMcpResource("http://mail.example.com")).toThrow("HTTPS");
		expect(() => canonicalMcpResource("https://mail.example.com/base")).toThrow("origin");
	});

	it("defaults consent to read even when a client requests actions", () => {
		expect(selectConsentProfile(undefined, [MCP_READ_SCOPE, MCP_ACTION_SCOPE])).toBe("read");
		expect(selectConsentProfile("read", [MCP_READ_SCOPE, MCP_ACTION_SCOPE])).toBe("read");
		expect(selectConsentProfile("actions", [MCP_READ_SCOPE])).toBe("read");
		expect(selectConsentProfile("actions", [MCP_READ_SCOPE, MCP_ACTION_SCOPE])).toBe("actions");
	});

	it("keeps the action profile an explicit read superset", () => {
		expect(grantedScopesForProfile("read")).toEqual([MCP_READ_SCOPE]);
		expect(grantedScopesForProfile("actions")).toEqual([MCP_READ_SCOPE, MCP_ACTION_SCOPE]);
		expect(hasMcpScope([MCP_READ_SCOPE], MCP_READ_SCOPE)).toBe(true);
		expect(hasMcpScope([MCP_READ_SCOPE], MCP_ACTION_SCOPE)).toBe(false);
		expect(hasMcpScope([MCP_READ_SCOPE, MCP_ACTION_SCOPE], MCP_ACTION_SCOPE)).toBe(true);
	});

	it("requires the live user, organization, approving session, and connection to match", () => {
		const binding = {
			userId: "usr_1",
			organizationId: "org_1",
			sessionId: "sess_1",
			connectionId: "mcp_1",
		} as const;
		const active = {
			userId: "usr_1",
			organizationId: "org_1",
			sessionId: "sess_1",
			connectionId: "mcp_1",
			connectionRevoked: false,
		} as const;

		expect(isGrantBindingActive(binding, active)).toBe(true);
		for (const changed of [
			{ ...active, userId: "usr_2" },
			{ ...active, organizationId: "org_2" },
			{ ...active, sessionId: "sess_2" },
			{ ...active, connectionId: "mcp_2" },
			{ ...active, connectionRevoked: true },
			{ ...active, sessionId: null },
		] as const) {
			expect(isGrantBindingActive(binding, changed)).toBe(false);
		}
	});
});
