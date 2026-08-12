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
import type { NextResponse } from "next/server";
import {
	SESSION_COOKIE,
	createSession,
	deleteSession,
	generateSessionToken,
	getActiveOrgMembership,
	getUserFromSession,
	hashSessionToken,
	setSessionCookie,
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
		expect(values.authenticatedAt).toBeInstanceOf(Date);
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
		const names = new Set<string>();
		const seen = new WeakSet<object>();
		function collectColumnNames(value: unknown): void {
			if (!value || typeof value !== "object" || seen.has(value)) return;
			seen.add(value);
			if ("name" in value && typeof value.name === "string") names.add(value.name);
			for (const child of Object.values(value)) collectColumnNames(child);
		}
		collectColumnNames(mock.wheres.at(-1));
		expect(names).toContain("user_id");
		expect(names).toContain("organization_id");
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

	it("performs exactly one bcrypt comparison for a matching session", async () => {
		mock
			.queueSelect([{ tokenHash: "hashed:tok", userId: "u1" }])
			.queueSelect([{ id: "u1", organizationId: null }]);

		await getUserFromSession(env, "tok");

		// The row is found by indexed digest, so cost no longer grows with the
		// number of active sessions (F66).
		expect(vi.mocked(bcrypt.compareSync)).toHaveBeenCalledTimes(1);
	});

	it("performs no bcrypt comparison when the digest matches nothing", async () => {
		mock.queueSelect([]);

		expect(await getUserFromSession(env, "tok")).toBeNull();
		expect(vi.mocked(bcrypt.compareSync)).not.toHaveBeenCalled();
	});

	it("rejects a row whose digest matched but whose hash does not verify", async () => {
		mock.queueSelect([{ tokenHash: "hashed:other", userId: "u1" }]);

		// Authentication still depends on bcrypt, so the digest alone never admits.
		expect(await getUserFromSession(env, "tok")).toBeNull();
		expect(vi.mocked(bcrypt.compareSync)).toHaveBeenCalledTimes(1);
	});
});

describe("getActiveOrgMembership", () => {
	it("returns null for a user with no active-org pointer", async () => {
		expect(await getActiveOrgMembership(env, { id: "u1", organizationId: null })).toBeNull();
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("pairs the active-org pointer with the membership row's role", async () => {
		mock.queueSelect([{ role: "owner" }]);
		expect(await getActiveOrgMembership(env, { id: "u1", organizationId: "org_1" })).toEqual({
			organizationId: "org_1",
			role: "owner",
		});
	});

	it("keeps an inconsistent pointer org-scoped but role-less (T-41 consistency)", async () => {
		// Consistency case: users.organizationId points at an org that has NO
		// matching organizationMembers row. CURRENT behavior — deliberately
		// preserved, not fixed, in this batch: the user remains scoped to the
		// pointed-at org (organizationId is still returned) but with role: null,
		// so every role-gated guard (org admin/owner) denies. Column retirement
		// will make the join table the single source of truth post-batch.
		mock.queueSelect([]);
		expect(await getActiveOrgMembership(env, { id: "u1", organizationId: "org_orphan" })).toEqual({
			organizationId: "org_orphan",
			role: null,
		});
	});
});

describe("setSessionCookie", () => {
	it("sets the session cookie with the canonical attributes", () => {
		const set = vi.fn();
		const response = { cookies: { set } } as unknown as NextResponse;

		setSessionCookie(response, "sess_tok");

		expect(set).toHaveBeenCalledTimes(1);
		expect(set).toHaveBeenCalledWith(SESSION_COOKIE, "sess_tok", {
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60 * 24 * 30,
		});
	});
});

describe("deleteSession", () => {
	it("deletes by digest without scanning or hashing", async () => {
		await deleteSession(env, "tok");

		// A targeted delete on a unique digest removes the one row if it exists and
		// nothing otherwise, so it is idempotent and needs no bcrypt.
		expect(mock.deletes).toHaveLength(1);
		expect(vi.mocked(bcrypt.compareSync)).not.toHaveBeenCalled();
		expect(mock.db.select).not.toHaveBeenCalled();
	});
});
