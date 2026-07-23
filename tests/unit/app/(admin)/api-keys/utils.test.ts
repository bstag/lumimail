import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import {
	createApiKey,
	formatApiKeyTimestamp,
	listApiKeys,
	parseApiKeyScopes,
	revokeApiKey,
} from "@/app/(admin)/api-keys/utils";
import { parseScopes } from "@/lib/api-keys";

beforeEach(() => authFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

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

describe("API key lifecycle clients", () => {
	it("lists lifecycle metadata without expecting a secret", async () => {
		const apiKeys = [{ id: "key_1", name: "CI", prefix: "ep_123", scopes: "[]", revokedAt: null }];
		authFetch.mockResolvedValue(Response.json({ apiKeys }));
		await expect(listApiKeys()).resolves.toEqual(apiKeys);
		expect(authFetch).toHaveBeenCalledWith("/api/api-keys");
	});

	it("creates a key and returns its one-time secret", async () => {
		authFetch.mockResolvedValue(
			Response.json({ id: "key_1", name: "CI", prefix: "ep_123", key: "ep_secret" }),
		);
		await expect(createApiKey("CI")).resolves.toEqual({
			id: "key_1",
			name: "CI",
			prefix: "ep_123",
			key: "ep_secret",
		});
		expect(authFetch).toHaveBeenCalledWith("/api/api-keys", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "CI", scopes: ["send", "read"] }),
		});
	});

	it("revokes a key with DELETE", async () => {
		authFetch.mockResolvedValue(Response.json({ ok: true }));
		await expect(revokeApiKey("key_1")).resolves.toBeUndefined();
		expect(authFetch).toHaveBeenCalledWith("/api/api-keys/key_1", { method: "DELETE" });
	});

	it.each([
		["list", () => listApiKeys()],
		["create", () => createApiKey("CI")],
		["revoke", () => revokeApiKey("key_1")],
	])("surfaces the API error for %s", async (_name, invoke) => {
		authFetch.mockResolvedValue(
			Response.json({ error: "Lifecycle failed" }, { status: 400 }),
		);
		await expect(invoke()).rejects.toThrow("Lifecycle failed");
	});

	it("uses a safe fallback when an error response has no message", async () => {
		authFetch.mockResolvedValue(Response.json({}, { status: 500 }));
		await expect(listApiKeys()).rejects.toThrow("API key request failed");
	});
});

describe("formatApiKeyTimestamp", () => {
	it("shows Never for an unused key", () => {
		expect(formatApiKeyTimestamp(null)).toBe("Never");
	});

	it("shows Unknown for malformed stored metadata", () => {
		expect(formatApiKeyTimestamp("not-a-date")).toBe("Unknown");
	});

	it("formats a valid lifecycle timestamp", () => {
		const formatted = formatApiKeyTimestamp("2026-07-22T22:20:00.000Z", "en-US", "UTC");
		expect(formatted).toContain("Jul");
		expect(formatted).toContain("2026");
		expect(formatted).toContain("UTC");
	});
});
