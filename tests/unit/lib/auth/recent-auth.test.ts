import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/auth/password", () => ({
	verifyPassword: (password: string, hash: string) => hash === `hash:${password}`,
}));
vi.mock("@/lib/auth/session", () => ({
	lookupSessionToken: async (token: string) => `lookup:${token}`,
}));

import {
	RECENT_AUTH_WINDOW_MS,
	isSessionRecentlyAuthenticated,
	readRecentlyAuthenticatedSession,
	reconfirmSession,
} from "@/lib/auth/recent-auth";

const env = {} as CloudflareEnv;
const now = new Date("2026-08-12T20:00:00.000Z");
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
});

describe("reconfirmSession", () => {
	it("fails without reading when no current credential is presented", async () => {
		expect(await reconfirmSession(env, "usr_1", undefined, "secret", now)).toEqual({ confirmed: false });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("uses the same bounded failure for a missing user or wrong password", async () => {
		mock.queueSelect([]);
		expect(await reconfirmSession(env, "usr_1", "session", "secret", now)).toEqual({ confirmed: false });

		mock.queueSelect([{ passwordHash: "hash:other" }]);
		expect(await reconfirmSession(env, "usr_1", "session", "secret", now)).toEqual({ confirmed: false });
		expect(mock.updates).toHaveLength(0);
	});

	it("fails if the exact active session disappears before the update", async () => {
		mock.queueSelect([{ passwordHash: "hash:secret" }]);
		mock.queueSelect([]);
		expect(await reconfirmSession(env, "usr_1", "session", "secret", now)).toEqual({ confirmed: false });
	});

	it("updates only the presented active session and returns the freshness expiry", async () => {
		mock.queueSelect([{ passwordHash: "hash:secret" }]);
		mock.queueSelect([{ id: "sess_1" }]);
		const result = await reconfirmSession(env, "usr_1", "session", "secret", now);
		expect(result).toEqual({
			confirmed: true,
			recentUntil: new Date(now.getTime() + RECENT_AUTH_WINDOW_MS),
		});
		expect(mock.updates[0].set).toEqual({ authenticatedAt: now });
		expect(mock.wheres).toHaveLength(2);
	});
});

describe("isSessionRecentlyAuthenticated", () => {
	it("rejects a missing credential or missing exact session", async () => {
		expect(await isSessionRecentlyAuthenticated(env, "usr_1", undefined, now)).toBe(false);
		mock.queueSelect([]);
		expect(await isSessionRecentlyAuthenticated(env, "usr_1", "session", now)).toBe(false);
	});

	it("accepts only authentication timestamps inside the window and not in the future", async () => {
		mock.queueSelect([{ authenticatedAt: null }]);
		expect(await isSessionRecentlyAuthenticated(env, "usr_1", "session", now)).toBe(false);

		mock.queueSelect([{ authenticatedAt: new Date(now.getTime() - RECENT_AUTH_WINDOW_MS) }]);
		expect(await isSessionRecentlyAuthenticated(env, "usr_1", "session", now)).toBe(true);

		mock.queueSelect([{ authenticatedAt: new Date(now.getTime() - RECENT_AUTH_WINDOW_MS - 1) }]);
		expect(await isSessionRecentlyAuthenticated(env, "usr_1", "session", now)).toBe(false);

		mock.queueSelect([{ authenticatedAt: new Date(now.getTime() + 1) }]);
		expect(await isSessionRecentlyAuthenticated(env, "usr_1", "session", now)).toBe(false);
	});

	it("returns bounded context only for a recent exact active session", async () => {
		mock.queueSelect([{
			id: "sess_1", organizationId: "org_1", tokenLookup: "lookup:session",
			authenticatedAt: new Date(now.getTime() - 1),
		}]);
		expect(await readRecentlyAuthenticatedSession(env, "usr_1", "session", now)).toEqual({
			id: "sess_1", organizationId: "org_1", tokenLookup: "lookup:session",
		});

		mock.queueSelect([{ id: "sess_1", organizationId: "org_1", tokenLookup: "lookup:session", authenticatedAt: null }]);
		expect(await readRecentlyAuthenticatedSession(env, "usr_1", "session", now)).toBeNull();
	});
});
