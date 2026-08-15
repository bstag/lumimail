import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	accessibleMailboxIds: vi.fn(),
	recentSession: vi.fn(),
	lookup: vi.fn(),
	verify: vi.fn(),
	hash: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/auth/mailbox-access", () => ({ listAccessibleMailboxIds: h.accessibleMailboxIds }));
vi.mock("@/lib/auth/recent-auth", () => ({ readRecentlyAuthenticatedSession: h.recentSession }));
vi.mock("@/lib/auth/session", () => ({ lookupSessionToken: h.lookup, verifySessionToken: h.verify }));
vi.mock("@/lib/crypto-utils", () => ({ sha256Hex: h.hash }));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix ?? "id"}_fixed` }));

import {
	listPushDevices,
	registerPushDevice,
	renamePushDevice,
	replacePushDevicePreferences,
	revokePushDevice,
} from "@/lib/push/devices";

const subscription = {
	endpoint: "https://fcm.googleapis.com/fcm/send/token",
	keys: { p256dh: "public-key", auth: "auth-secret" },
};

describe("push device lifecycle", () => {
	let mock: ReturnType<typeof createDbMock>;

	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
		h.accessibleMailboxIds.mockReset().mockResolvedValue(["mbx_1", "mbx_2"]);
		h.recentSession.mockReset().mockResolvedValue({ id: "sess_1", organizationId: "org_1" });
		h.lookup.mockReset().mockResolvedValue("lookup_1");
		h.verify.mockReset().mockReturnValue(true);
		h.hash.mockReset().mockResolvedValue("endpoint_hash");
	});

	it("registers an exact-session device with zero implicit mailbox preferences", async () => {
		mock.queueSelect([{
			id: "sess_1", organizationId: "org_1", tokenHash: "stored-hash",
		}]);
		mock.queueSelect([]); // no endpoint or session conflict
		mock.queueSelect([{ count: 2 }]);

		await expect(registerPushDevice({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "session-token",
			name: "Laptop", subscription, requestId: "req_1", now: new Date(1_000),
		})).resolves.toEqual({ status: "created", device: {
			id: "pud_fixed", name: "Laptop", status: "active", mailboxIds: [], current: true,
			createdAt: new Date(1_000).toISOString(), lastDeliveredAt: null,
		} });

		expect(mock.inserts[0].values).toMatchObject({
			id: "pud_fixed", userId: "usr_1", organizationId: "org_1", approvingSessionId: "sess_1",
			name: "Laptop", endpoint: subscription.endpoint, endpointHash: "endpoint_hash",
			p256dh: "public-key", auth: "auth-secret", status: "active",
		});
		expect(mock.inserts).toHaveLength(2);
		expect(mock.db.batch).toHaveBeenCalledOnce();
		expect(JSON.stringify(mock.inserts[1].values)).not.toMatch(/endpoint|p256dh|auth|laptop/i);
	});

	it("fails closed for invalid exact sessions, conflicts, and the active-device cap", async () => {
		await expect(registerPushDevice({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: undefined,
			name: "Laptop", subscription, requestId: "req_0",
		})).resolves.toEqual({ status: "invalid-session" });

		mock.queueSelect([]);
		await expect(registerPushDevice({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "bad",
			name: "Laptop", subscription, requestId: "req_1",
		})).resolves.toEqual({ status: "invalid-session" });
		expect(mock.inserts).toHaveLength(0);

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([{ id: "sess_1", organizationId: "org_1", tokenHash: "hash" }]);
		mock.queueSelect([{ id: "pud_other", userId: "usr_other", approvingSessionId: "sess_other" }]);
		await expect(registerPushDevice({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "token",
			name: "Laptop", subscription, requestId: "req_2",
		})).resolves.toEqual({ status: "conflict" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([{ id: "sess_1", organizationId: "org_1", tokenHash: "hash" }]);
		mock.queueSelect([]);
		mock.queueSelect([{ count: 10 }]);
		await expect(registerPushDevice({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "token",
			name: "Laptop", subscription, requestId: "req_3",
		})).resolves.toEqual({ status: "limit" });
	});

	it("updates the current exact-session device without changing its original date", async () => {
		mock.queueSelect([{ id: "sess_1", organizationId: "org_1", tokenHash: "hash" }]);
		mock.queueSelect([{
			id: "pud_1", userId: "usr_1", organizationId: "org_1",
			approvingSessionId: "sess_1", endpointHash: "old", createdAt: new Date(500),
			lastDeliveredAt: new Date(700),
		}]);
		await expect(registerPushDevice({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "token",
			name: "Renamed", subscription, requestId: "req_update", now: new Date(1_000),
		})).resolves.toEqual({ status: "updated", device: {
			id: "pud_1", name: "Renamed", status: "active", mailboxIds: [], current: true,
			createdAt: new Date(500).toISOString(), lastDeliveredAt: new Date(700).toISOString(),
		} });
		expect(mock.updates[0].set).toMatchObject({ name: "Renamed", endpointHash: "endpoint_hash" });
	});

	it.each([
		[{ userId: "usr_other", organizationId: "org_1" }],
		[{ userId: "usr_1", organizationId: "org_other" }],
	])("refuses to update a current-session row outside its actor boundary", async (owner) => {
		mock.queueSelect([{ id: "sess_1", organizationId: "org_1", tokenHash: "hash" }]);
		mock.queueSelect([{
			id: "pud_1", ...owner, approvingSessionId: "sess_1",
			endpointHash: "old", createdAt: new Date(500), lastDeliveredAt: null,
		}]);
		await expect(registerPushDevice({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "token",
			name: "Laptop", subscription, requestId: "req_conflict",
		})).resolves.toEqual({ status: "conflict" });
	});

	it("lists secret-free devices and only currently accessible preferences", async () => {
		mock.queueSelect([
			{ id: "pud_1", name: "Laptop", status: "active", approvingSessionId: "sess_1", createdAt: new Date(1), lastDeliveredAt: null },
			{ id: "pud_2", name: "Old phone", status: "revoked", approvingSessionId: "sess_old", createdAt: new Date(2), lastDeliveredAt: new Date(3) },
		]);
		mock.queueSelect([
			{ deviceId: "pud_1", mailboxId: "mbx_1" },
			{ deviceId: "pud_1", mailboxId: "mbx_removed" },
		]);
		mock.queueSelect([{ id: "sess_1" }]);

		const result = await listPushDevices({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "token",
		});
		expect(result).toEqual({ devices: [
			{ id: "pud_1", name: "Laptop", status: "active", current: true, mailboxIds: ["mbx_1"], createdAt: new Date(1).toISOString(), lastDeliveredAt: null },
			{ id: "pud_2", name: "Old phone", status: "revoked", current: false, mailboxIds: [], createdAt: new Date(2).toISOString(), lastDeliveredAt: new Date(3).toISOString() },
		] });
		expect(JSON.stringify(result)).not.toMatch(/endpoint|p256dh|auth|session/i);
	});

	it("lists an empty device collection without querying preferences", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]);
		await expect(listPushDevices({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionToken: "token",
		})).resolves.toEqual({ devices: [] });
	});

	it("renames only an owned active device and emits content-free audit", async () => {
		mock.queueSelect([{ id: "pud_1" }]);
		await expect(renamePushDevice({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1", name: "Phone",
			requestId: "req_rename", now: new Date(2_000),
		})).resolves.toEqual({ status: "updated" });
		expect(mock.updates[0].set).toMatchObject({ name: "Phone", updatedAt: new Date(2_000) });
		expect(JSON.stringify(mock.inserts[0].values)).not.toMatch(/phone|endpoint|key/i);

		mock = createDbMock(); h.db = mock.db; mock.queueSelect([]);
		await expect(renamePushDevice({} as CloudflareEnv, {
			deviceId: "foreign", userId: "usr_1", organizationId: "org_1", name: "Phone", requestId: "req_x",
		})).resolves.toEqual({ status: "not-found" });
	});

	it("uses the current time for rename and preference mutations when omitted", async () => {
		mock.queueSelect([{ id: "pud_1" }]);
		await expect(renamePushDevice({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			name: "Phone", requestId: "req_now",
		})).resolves.toEqual({ status: "updated" });
		expect(mock.updates[0].set).toMatchObject({ updatedAt: expect.any(Date) });

		mock = createDbMock(); h.db = mock.db; mock.queueSelect([{ id: "pud_1" }]);
		await expect(replacePushDevicePreferences({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			mailboxIds: [], requestId: "req_now_prefs",
		})).resolves.toEqual({ status: "updated", mailboxIds: [] });
	});

	it("atomically replaces only live readable mailbox preferences", async () => {
		mock.queueSelect([]);
		await expect(replacePushDevicePreferences({} as CloudflareEnv, {
			deviceId: "missing", userId: "usr_1", organizationId: "org_1",
			mailboxIds: [], requestId: "req_missing",
		})).resolves.toEqual({ status: "not-found" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([{ id: "pud_1" }]);
		await expect(replacePushDevicePreferences({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			mailboxIds: ["mbx_2", "mbx_1"], requestId: "req_prefs", now: new Date(3_000),
		})).resolves.toEqual({ status: "updated", mailboxIds: ["mbx_1", "mbx_2"] });
		expect(mock.inserts.find((insert) => Array.isArray(insert.values))?.values).toEqual([
			{ deviceId: "pud_1", mailboxId: "mbx_1", createdAt: new Date(3_000) },
			{ deviceId: "pud_1", mailboxId: "mbx_2", createdAt: new Date(3_000) },
		]);
		expect(mock.db.batch).toHaveBeenCalledOnce();

		mock = createDbMock(); h.db = mock.db; mock.queueSelect([{ id: "pud_1" }]);
		await expect(replacePushDevicePreferences({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			mailboxIds: ["mbx_foreign"], requestId: "req_bad",
		})).resolves.toEqual({ status: "forbidden-mailbox" });
		expect(mock.db.batch).not.toHaveBeenCalled();

		mock = createDbMock(); h.db = mock.db; mock.queueSelect([{ id: "pud_1" }]);
		await expect(replacePushDevicePreferences({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			mailboxIds: [], requestId: "req_empty", now: new Date(3_500),
		})).resolves.toEqual({ status: "updated", mailboxIds: [] });
		expect(mock.db.batch).toHaveBeenCalledOnce();
	});

	it("requires recent exact authentication and revokes server delivery atomically", async () => {
		h.recentSession.mockResolvedValueOnce(null);
		await expect(revokePushDevice({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1", sessionToken: "stale", requestId: "req_1",
		})).resolves.toEqual({ status: "recent-auth-required" });

		mock.queueSelect([{ id: "pud_1" }]);
		await expect(revokePushDevice({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1", sessionToken: "recent",
			requestId: "req_2", now: new Date(4_000),
		})).resolves.toEqual({ status: "revoked" });
		expect(mock.updates[0].set).toMatchObject({ status: "revoked", revokedAt: new Date(4_000) });
		expect(mock.deletes).toHaveLength(1);
		expect(mock.db.batch).toHaveBeenCalledOnce();
	});

	it("rejects a recent session from another organization and an absent device", async () => {
		h.recentSession.mockResolvedValueOnce({ id: "sess_1", organizationId: "org_other" });
		await expect(revokePushDevice({} as CloudflareEnv, {
			deviceId: "pud_1", userId: "usr_1", organizationId: "org_1",
			sessionToken: "recent", requestId: "req_wrong_org",
		})).resolves.toEqual({ status: "recent-auth-required" });

		mock.queueSelect([]);
		await expect(revokePushDevice({} as CloudflareEnv, {
			deviceId: "missing", userId: "usr_1", organizationId: "org_1",
			sessionToken: "recent", requestId: "req_missing",
		})).resolves.toEqual({ status: "not-found" });
	});
});
