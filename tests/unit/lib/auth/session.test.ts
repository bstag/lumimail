import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

vi.mock("bcryptjs", () => ({
	default: {
		hashSync: vi.fn((token: string) => `hashed:${token}`),
		compareSync: vi.fn((token: string, hash: string) => hash === `hashed:${token}`),
	},
}));

const idCalls: (string | undefined)[] = [];
vi.mock("@/lib/ids", () => ({
	newId: vi.fn((prefix?: string) => {
		idCalls.push(prefix);
		return prefix ? `${prefix}_id` : "plain_id";
	}),
}));

import bcrypt from "bcryptjs";
import {
	SESSION_COOKIE,
	createSession,
	deleteSession,
	generateSessionToken,
	getUserFromSession,
	hashSessionToken,
	verifySessionToken,
} from "@/lib/auth/session";

const env = {} as CloudflareEnv;
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
	idCalls.length = 0;
	vi.clearAllMocks();
});

describe("constants and token helpers", () => {
	it("exposes the session cookie name", () => {
		expect(SESSION_COOKIE).toBe("ep_session");
	});

	it("generates a session token with the sess prefix", () => {
		expect(generateSessionToken()).toBe("sess_id");
		expect(idCalls).toContain("sess");
	});

	it("hashes a token via bcrypt", () => {
		expect(hashSessionToken("tok")).toBe("hashed:tok");
		expect(bcrypt.hashSync).toHaveBeenCalledWith("tok", 10);
	});

	it("verifies a matching token", () => {
		expect(verifySessionToken("tok", "hashed:tok")).toBe(true);
	});

	it("rejects a non-matching token", () => {
		expect(verifySessionToken("tok", "hashed:other")).toBe(false);
	});
});

describe("createSession", () => {
	it("stores the user's organizationId when the user exists", async () => {
		mock.queueSelect([{ organizationId: "org_1" }]);
		const token = await createSession(env, "u1");
		expect(token).toBe("sess_id");
		expect(mock.inserts).toHaveLength(1);
		const values = mock.inserts[0].values as Record<string, unknown>;
		expect(values.userId).toBe("u1");
		expect(values.tokenHash).toBe("hashed:sess_id");
		expect(values.organizationId).toBe("org_1");
		expect(values.expiresAt).toBeInstanceOf(Date);
		// id was generated without a prefix
		expect(idCalls).toContain(undefined);
	});

	it("falls back to null organizationId when the user is missing", async () => {
		mock.queueSelect([]);
		await createSession(env, "u1");
		const values = mock.inserts[0].values as Record<string, unknown>;
		expect(values.organizationId).toBeNull();
	});

	it("falls back to null when the user has no organizationId", async () => {
		mock.queueSelect([{ organizationId: null }]);
		await createSession(env, "u1");
		const values = mock.inserts[0].values as Record<string, unknown>;
		expect(values.organizationId).toBeNull();
	});

	it("sets expiry 30 days in the future", async () => {
		mock.queueSelect([{ organizationId: "org_1" }]);
		const before = Date.now();
		await createSession(env, "u1");
		const values = mock.inserts[0].values as Record<string, unknown>;
		const expiresAt = values.expiresAt as Date;
		const days = (expiresAt.getTime() - before) / (1000 * 60 * 60 * 24);
		expect(days).toBeGreaterThan(29);
		expect(days).toBeLessThan(31);
	});
});

describe("getUserFromSession", () => {
	it("returns null when no token is provided", async () => {
		expect(await getUserFromSession(env, undefined)).toBeNull();
	});

	it("returns null when no session matches the token", async () => {
		mock.queueSelect([{ tokenHash: "hashed:other", userId: "u1" }]);
		expect(await getUserFromSession(env, "tok")).toBeNull();
	});

	it("returns null when the matched session's user is missing", async () => {
		mock
			.queueSelect([{ tokenHash: "hashed:tok", userId: "u1" }])
			.queueSelect([]);
		expect(await getUserFromSession(env, "tok")).toBeNull();
	});

	it("returns a non-org user without a role lookup", async () => {
		mock
			.queueSelect([{ tokenHash: "hashed:tok", userId: "u1" }])
			.queueSelect([{ id: "u1", organizationId: null }]);
		expect(await getUserFromSession(env, "tok")).toEqual({ id: "u1", organizationId: null });
	});

	it("attaches the membership role for an org user", async () => {
		mock
			.queueSelect([{ tokenHash: "hashed:tok", userId: "u1" }])
			.queueSelect([{ id: "u1", organizationId: "org_1" }])
			.queueSelect([{ role: "admin" }]);
		expect(await getUserFromSession(env, "tok")).toEqual({
			id: "u1",
			organizationId: "org_1",
			role: "admin",
		});
	});

	it("uses a null role when no membership row exists", async () => {
		mock
			.queueSelect([{ tokenHash: "hashed:tok", userId: "u1" }])
			.queueSelect([{ id: "u1", organizationId: "org_1" }])
			.queueSelect([]);
		expect(await getUserFromSession(env, "tok")).toEqual({
			id: "u1",
			organizationId: "org_1",
			role: null,
		});
	});

	it("skips non-matching sessions before finding the match", async () => {
		mock
			.queueSelect([
				{ tokenHash: "hashed:nope", userId: "ux" },
				{ tokenHash: "hashed:tok", userId: "u1" },
			])
			.queueSelect([{ id: "u1", organizationId: null }]);
		expect(await getUserFromSession(env, "tok")).toEqual({ id: "u1", organizationId: null });
	});
});

describe("deleteSession", () => {
	it("deletes the session whose hash matches", async () => {
		mock.queueSelect([
			{ id: "s1", tokenHash: "hashed:nope" },
			{ id: "s2", tokenHash: "hashed:tok" },
		]);
		await deleteSession(env, "tok");
		expect(mock.deletes).toHaveLength(1);
	});

	it("deletes nothing when no hash matches", async () => {
		mock.queueSelect([{ id: "s1", tokenHash: "hashed:other" }]);
		await deleteSession(env, "tok");
		expect(mock.deletes).toHaveLength(0);
	});
});
