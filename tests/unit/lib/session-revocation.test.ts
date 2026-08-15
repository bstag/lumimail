import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	current: null as null | { id: string; organizationId: string | null; tokenLookup: string },
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/auth/recent-auth", () => ({
	readRecentlyAuthenticatedSession: vi.fn(async () => h.current),
}));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix}_fixed` }));

import {
	revokeOtherOrganizationSessions,
	revokeOrganizationSession,
} from "@/lib/session-revocation";

const env = {} as CloudflareEnv;
const now = new Date("2026-08-12T21:00:00.000Z");
let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
	h.current = { id: "sess_current", organizationId: "org_1", tokenLookup: "lookup_current" };
});

describe("revokeOrganizationSession", () => {
	it("requires a recent exact session in the active organization before target reads", async () => {
		h.current = null;
		expect(await revokeOrganizationSession(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			targetSessionId: "sess_target", requestId: "req_1", now,
		})).toEqual({ status: "recent-auth-required" });
		expect(mock.db.select).not.toHaveBeenCalled();

		h.current = { id: "sess_current", organizationId: "org_other", tokenLookup: "lookup_current" };
		expect(await revokeOrganizationSession(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			targetSessionId: "sess_target", requestId: "req_1", now,
		})).toEqual({ status: "recent-auth-required" });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("rejects the current session without target reads or audit", async () => {
		expect(await revokeOrganizationSession(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			targetSessionId: "sess_current", requestId: "req_1", now,
		})).toEqual({ status: "current-session" });
		expect(mock.db.select).not.toHaveBeenCalled();
		expect(mock.db.batch).not.toHaveBeenCalled();
	});

	it("returns the same not-found result for an absent or out-of-scope active target", async () => {
		mock.queueSelect([]);
		expect(await revokeOrganizationSession(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			targetSessionId: "sess_missing", requestId: "req_1", now,
		})).toEqual({ status: "not-found" });
		expect(mock.db.batch).not.toHaveBeenCalled();
	});

	it("batches the scoped deletion with one content-free audit event", async () => {
		mock.queueSelect([{ id: "sess_target" }]);
		expect(await revokeOrganizationSession(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			targetSessionId: "sess_target", requestId: "req_1", now,
		})).toEqual({ status: "revoked", revokedCount: 1, requestId: "req_1" });
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
		expect(mock.deletes).toHaveLength(1);
		expect(mock.inserts[0].values).toEqual({
			id: "aud_fixed", organizationId: "org_1", actorUserId: "usr_owner",
			action: "session.revoke", resourceType: "session", resourceId: "sess_target",
			affectedCount: 1, requestId: "req_1", outcome: "succeeded", createdAt: now,
		});
		expect(JSON.stringify(mock.inserts[0].values)).not.toMatch(/token|password|email|ip|agent/i);
	});

	it("uses the current time when a caller does not inject a clock", async () => {
		mock.queueSelect([{ id: "sess_target" }]);
		await expect(revokeOrganizationSession(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			targetSessionId: "sess_target", requestId: "req_clock",
		})).resolves.toMatchObject({ status: "revoked" });
		expect(mock.inserts[0].values).toMatchObject({ createdAt: expect.any(Date) });
	});

	it("propagates a failed atomic batch instead of claiming revocation", async () => {
		mock.queueSelect([{ id: "sess_target" }]);
		mock.db.batch.mockRejectedValueOnce(new Error("D1 unavailable"));
		await expect(revokeOrganizationSession(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			targetSessionId: "sess_target", requestId: "req_failed", now,
		})).rejects.toThrow("D1 unavailable");
	});
});

describe("revokeOtherOrganizationSessions", () => {
	it("fails closed before reads when recent authentication is absent", async () => {
		h.current = null;
		expect(await revokeOtherOrganizationSessions(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: undefined,
			requestId: "req_2", now,
		})).toEqual({ status: "recent-auth-required" });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("preserves the current session and audits zero or more organization sessions atomically", async () => {
		mock.queueSelect([{ id: "sess_a" }, { id: "sess_b" }]);
		expect(await revokeOtherOrganizationSessions(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			requestId: "req_2", now,
		})).toEqual({ status: "revoked", revokedCount: 2, requestId: "req_2" });
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
		expect(mock.inserts[0].values).toMatchObject({
			action: "session.revoke_others", resourceId: null, affectedCount: 2,
			requestId: "req_2", outcome: "succeeded",
		});

		mock = createDbMock();
		h.db = mock.db;
		mock.queueSelect([]);
		expect(await revokeOtherOrganizationSessions(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token",
			requestId: "req_3", now,
		})).toMatchObject({ status: "revoked", revokedCount: 0 });
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
	});

	it("uses the current time when no clock is injected", async () => {
		mock.queueSelect([]);
		await expect(revokeOtherOrganizationSessions(env, {
			organizationId: "org_1", actorUserId: "usr_owner", currentToken: "token", requestId: "req_clock",
		})).resolves.toMatchObject({ status: "revoked", revokedCount: 0 });
		expect(mock.inserts[0].values).toMatchObject({ createdAt: expect.any(Date) });
	});
});
