import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	mailboxIds: vi.fn(),
	access: vi.fn(),
	keyring: vi.fn(),
	decrypt: vi.fn(),
	revoke: vi.fn(),
	begin: vi.fn(),
	newId: vi.fn((prefix: string) => `${prefix}_1`),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/auth/mailbox-access", () => ({
	listAccessibleMailboxIds: h.mailboxIds,
	getMailboxAccess: h.access,
}));
vi.mock("@/lib/email/external/secret-vault", () => ({
	parseExternalSecretKeyring: h.keyring,
	decryptExternalSecret: h.decrypt,
}));
vi.mock("@/lib/email/external/oauth-provider", () => ({ revokeExternalRefreshToken: h.revoke }));
vi.mock("@/lib/email/external/connections", () => ({ beginExternalOAuth: h.begin }));
vi.mock("@/lib/ids", () => ({ newId: h.newId }));

import {
	beginExternalAccountReconnect,
	disconnectExternalAccount,
	getExternalAccount,
	listExternalAccounts,
	requestExternalAccountSync,
	updateExternalAccount,
} from "@/lib/email/external/account-management";

const account = {
	id: "exa_1", organizationId: "org_1", mailboxId: "mbx_1", ownerUserId: "usr_1",
	approvingSessionId: "sess_old", provider: "google" as const, externalAddress: "user@example.com",
	tokenCiphertext: "cipher", tokenIv: "iv", tokenKeyId: "v1", status: "active" as const,
	importMode: "from_now" as const, retainOriginal: false, lastSyncAt: null, lastErrorCode: null,
	createdAt: new Date("2026-08-15T00:00:00Z"), updatedAt: new Date("2026-08-15T00:00:00Z"), revokedAt: null,
};

describe("external account management", () => {
	let mock: DbMock;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		h.mailboxIds.mockResolvedValue(["mbx_1"]);
		h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "manager" });
		h.keyring.mockReturnValue({ active: "v1", keys: { v1: "key" } });
		h.decrypt.mockResolvedValue("refresh-secret");
		h.revoke.mockResolvedValue(undefined);
		h.begin.mockResolvedValue({ status: "created", redirectTo: "https://provider.example" });
	});

	it("lists only readable mailboxes and never returns token material", async () => {
		mock.queueSelect([{ ...account, mailboxLocalPart: "support", mailboxHostname: "example.com", ownerName: "Owner" }]);
		const rows = await listExternalAccounts({} as CloudflareEnv, "usr_1", "org_1");
		expect(rows).toHaveLength(1);
		expect(rows[0]).not.toHaveProperty("tokenCiphertext");
		expect(rows[0]).toMatchObject({ id: "exa_1", mailboxAddress: "support@example.com" });
		h.mailboxIds.mockResolvedValue([]);
		expect(await listExternalAccounts({} as CloudflareEnv, "usr_1", "org_1")).toEqual([]);
		expect(mock.db.select).toHaveBeenCalledTimes(1);
	});

	it("returns detail only to the owner or a live mailbox manager", async () => {
		mock.queueSelect([account]);
		expect(await getExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1"))
			.toMatchObject({ id: "exa_1" });
		expect(h.access).not.toHaveBeenCalled();
		mock.queueSelect([{ ...account, ownerUserId: "usr_other" }]);
		expect(await getExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1"))
			.toMatchObject({ id: "exa_1" });
		mock.queueSelect([{ ...account, ownerUserId: "usr_other" }]);
		h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "viewer" });
		expect(await getExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1")).toBeNull();
		mock.queueSelect([]);
		expect(await getExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "missing")).toBeNull();
	});

	it("enforces owner plus manager lifecycle transitions and prospective retention", async () => {
		mock.queueSelect([account]);
		expect(await updateExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1", {
			status: "paused", retainOriginal: true,
		})).toEqual({ status: "updated" });
		expect(mock.updates.at(-1)?.set).toMatchObject({ status: "paused", retainOriginal: true });

		mock.queueSelect([{ ...account, status: "paused" }]);
		expect(await updateExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1", {
			status: "active",
		})).toEqual({ status: "updated" });
		expect(mock.inserts.at(-1)?.values).toMatchObject({ accountId: "exa_1", kind: "incremental", status: "pending" });

		mock.queueSelect([account]);
		expect(await updateExternalAccount({} as CloudflareEnv, "usr_2", "org_1", "exa_1", { status: "paused" }))
			.toEqual({ status: "not-found" });
		mock.queueSelect([{ ...account, status: "active" }]);
		expect(await updateExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1", { status: "active" }))
			.toEqual({ status: "conflict" });
		h.access.mockResolvedValue(null);
		mock.queueSelect([account]);
		expect(await updateExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1", { status: "paused" }))
			.toEqual({ status: "not-found" });
		h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "manager" });
		mock.queueSelect([{ ...account, status: "disconnected" }]);
		expect(await updateExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1", { retainOriginal: true }))
			.toEqual({ status: "conflict" });
		mock.queueSelect([{ ...account, status: "paused" }]);
		expect(await updateExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1", { status: "paused" }))
			.toEqual({ status: "conflict" });
		mock.queueSelect([account]);
		expect(await updateExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1", { retainOriginal: true }))
			.toEqual({ status: "updated" });
	});

	it("disconnects locally before best-effort provider revocation and keeps imported data", async () => {
		mock.queueSelect([account]);
		expect(await disconnectExternalAccount({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "org_1", "exa_1", new Date("2026-08-15T12:00:00Z")))
			.toEqual({ status: "disconnected" });
		expect(mock.updates.at(-1)?.set).toMatchObject({
			status: "disconnected", tokenCiphertext: "", tokenIv: "", tokenKeyId: "",
		});
		expect(h.revoke).toHaveBeenCalledWith("google", "refresh-secret");
		h.revoke.mockRejectedValue(new Error("provider down"));
		mock.queueSelect([account]);
		expect(await disconnectExternalAccount({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "org_1", "exa_1")).toEqual({ status: "disconnected" });
		mock.queueSelect([{ ...account, status: "disconnected" }]);
		expect(await disconnectExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "exa_1"))
			.toEqual({ status: "conflict" });
		mock.queueSelect([]);
		expect(await disconnectExternalAccount({} as CloudflareEnv, "usr_1", "org_1", "missing"))
			.toEqual({ status: "not-found" });
	});

	it("queues one bounded manual sync and rejects paused or overlapping work", async () => {
		mock.queueSelect([account]).queueSelect([]);
		expect(await requestExternalAccountSync({ EXTERNAL_SYNC_QUEUE: { send: vi.fn() } } as unknown as CloudflareEnv,
			"usr_1", "org_1", "exa_1")).toEqual({ status: "accepted", jobId: "exj_1" });
		expect(mock.inserts.at(-1)?.values).toMatchObject({ kind: "incremental", accountId: "exa_1" });
		mock.queueSelect([account]).queueSelect([{ id: "exj_existing" }]);
		expect(await requestExternalAccountSync({} as CloudflareEnv, "usr_1", "org_1", "exa_1"))
			.toEqual({ status: "accepted", jobId: "exj_existing" });
		mock.queueSelect([{ ...account, status: "paused" }]);
		expect(await requestExternalAccountSync({} as CloudflareEnv, "usr_1", "org_1", "exa_1"))
			.toEqual({ status: "conflict" });
		mock.queueSelect([]);
		expect(await requestExternalAccountSync({} as CloudflareEnv, "usr_1", "org_1", "missing"))
			.toEqual({ status: "not-found" });
		mock.queueSelect([{ ...account, ownerUserId: "usr_other" }]).queueSelect([]);
		h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "manager" });
		expect(await requestExternalAccountSync({ EXTERNAL_SYNC_QUEUE: { send: vi.fn() } } as unknown as CloudflareEnv,
			"usr_1", "org_1", "exa_1")).toMatchObject({ status: "accepted" });
		mock.queueSelect([{ ...account, ownerUserId: "usr_other" }]);
		h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "viewer" });
		expect(await requestExternalAccountSync({} as CloudflareEnv, "usr_1", "org_1", "exa_1"))
			.toEqual({ status: "not-found" });
		mock.queueSelect([{ ...account, status: "resync_required" }]).queueSelect([]);
		expect(await requestExternalAccountSync({ EXTERNAL_SYNC_QUEUE: { send: vi.fn() } } as unknown as CloudflareEnv,
			"usr_1", "org_1", "exa_1")).toMatchObject({ status: "accepted" });
		expect(mock.inserts.at(-1)?.values).toMatchObject({ kind: "resync" });
	});

	it("starts a reconnect flow bound to the existing owner and account settings", async () => {
		mock.queueSelect([{ ...account, status: "reconnect_required" }]);
		expect(await beginExternalAccountReconnect({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_new", accountId: "exa_1",
		})).toEqual({ status: "created", redirectTo: "https://provider.example" });
		expect(h.begin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			reconnectAccountId: "exa_1", provider: "google", mailboxId: "mbx_1",
			importMode: "from_now", retainOriginal: false,
		}));
		mock.queueSelect([{ ...account, ownerUserId: "usr_other" }]);
		expect(await beginExternalAccountReconnect({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_new", accountId: "exa_1",
		})).toEqual({ status: "not-found" });
		mock.queueSelect([{ ...account, status: "initial_sync" }]);
		expect(await beginExternalAccountReconnect({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_new", accountId: "exa_1",
		})).toEqual({ status: "conflict" });
		mock.queueSelect([{ ...account, status: "connecting" }]);
		expect(await beginExternalAccountReconnect({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_new", accountId: "exa_1",
		})).toEqual({ status: "conflict" });
		h.begin.mockResolvedValue({ status: "forbidden" });
		mock.queueSelect([{ ...account, status: "error" }]);
		expect(await beginExternalAccountReconnect({} as CloudflareEnv, {
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_new", accountId: "exa_1",
		})).toEqual({ status: "not-found" });
	});
});
