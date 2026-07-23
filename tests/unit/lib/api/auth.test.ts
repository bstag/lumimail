import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	verifyApiKey: vi.fn(),
	parseScopes: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/api-keys", () => ({
	verifyApiKey: h.verifyApiKey,
	parseScopes: h.parseScopes,
}));

import { authenticateApiKey, requireScope } from "@/lib/api/auth";

const env = {} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
	vi.clearAllMocks();
	h.verifyApiKey.mockReset();
	h.parseScopes.mockReset();
});

describe("authenticateApiKey", () => {
	it("returns null when the header is missing", async () => {
		expect(await authenticateApiKey(env, null)).toBeNull();
	});

	it("returns null when the header is not a Bearer header", async () => {
		expect(await authenticateApiKey(env, "Basic xyz")).toBeNull();
	});

	it("returns null when the bearer key is blank", async () => {
		expect(await authenticateApiKey(env, "Bearer    ")).toBeNull();
	});

	it("returns null when no candidate verifies", async () => {
		mock.queueSelect([{ id: "k1", keyHash: "hash1", userId: "u1" }]);
		h.verifyApiKey.mockReturnValue(false);
		expect(await authenticateApiKey(env, "Bearer ep_secretkeyvalue")).toBeNull();
		expect(mock.updates).toHaveLength(0);
	});

	it("skips a candidate whose user is missing and keeps scanning", async () => {
		mock
			.queueSelect([
				{ id: "k1", keyHash: "hash1", userId: "u1" },
				{ id: "k2", keyHash: "hash2", userId: "u2" },
			])
			.queueSelect([]) // user lookup for k1 -> missing
			.queueSelect([{ id: "u2", email: "two@example.com" }]) // user lookup for k2
			.queueSelect([{ id: "k2" }]); // conditional last-use claim
		// k1 verifies but has no user; k2 verifies and resolves
		h.verifyApiKey.mockReturnValue(true);
		h.parseScopes.mockReturnValue(["read"]);

		const result = await authenticateApiKey(env, "Bearer ep_anothersecret");
		expect(result).toEqual({ userId: "u2", email: "two@example.com", scopes: ["read"] });
		// lastUsedAt updated once for the successful candidate
		expect(mock.updates).toHaveLength(1);
		expect((mock.updates[0].set as Record<string, unknown>).lastUsedAt).toBeInstanceOf(Date);
	});

	it("authenticates a valid key and records last use", async () => {
		mock
			.queueSelect([{ id: "k1", keyHash: "hash1", userId: "u1", scopes: "json" }])
			.queueSelect([{ id: "u1", email: "one@example.com" }])
			.queueSelect([{ id: "k1" }]);
		h.verifyApiKey.mockReturnValue(true);
		h.parseScopes.mockReturnValue(["messages:read", "messages:write"]);

		const result = await authenticateApiKey(env, "Bearer ep_validkey1234567");
		expect(result).toEqual({
			userId: "u1",
			email: "one@example.com",
			scopes: ["messages:read", "messages:write"],
		});
		expect(h.parseScopes).toHaveBeenCalledWith("json");
		expect(mock.updates).toHaveLength(1);
	});

	it("skips a revoked candidate defensively", async () => {
		mock.queueSelect([
			{ id: "k1", keyHash: "hash1", userId: "u1", revokedAt: new Date(), scopes: "[]" },
		]);
		h.verifyApiKey.mockReturnValue(true);
		expect(await authenticateApiKey(env, "Bearer ep_revokedkeyvalue")).toBeNull();
		expect(h.verifyApiKey).not.toHaveBeenCalled();
		expect(mock.updates).toHaveLength(0);
	});

	it("fails authentication when revocation wins during key verification", async () => {
		mock
			.queueSelect([{ id: "k1", keyHash: "hash1", userId: "u1", revokedAt: null, scopes: "[]" }])
			.queueSelect([{ id: "u1", email: "one@example.com" }])
			.queueSelect([]); // conditional last-use claim observes revoked_at
		h.verifyApiKey.mockReturnValue(true);
		expect(await authenticateApiKey(env, "Bearer ep_revokedmidrequest")).toBeNull();
		expect(mock.updates).toHaveLength(1);
	});

	it("queries using the 12-char prefix of the key", async () => {
		mock.queueSelect([]);
		await authenticateApiKey(env, "Bearer ep_0123456789abcdef");
		// no candidates -> verifyApiKey never called
		expect(h.verifyApiKey).not.toHaveBeenCalled();
	});
});

describe("requireScope", () => {
	it("returns true when the exact scope is present", () => {
		expect(requireScope(["a", "b"], "a")).toBe(true);
	});

	it("returns true when the wildcard scope is present", () => {
		expect(requireScope(["*"], "anything")).toBe(true);
	});

	it("returns false when the scope is absent", () => {
		expect(requireScope(["a", "b"], "c")).toBe(false);
	});

	it("returns false for an empty scope list", () => {
		expect(requireScope([], "a")).toBe(false);
	});
});
