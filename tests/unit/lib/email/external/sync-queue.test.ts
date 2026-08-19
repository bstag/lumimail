import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	keyring: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(), refresh: vi.fn(),
	google: vi.fn(), microsoft: vi.fn(), apply: vi.fn(), read: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/external/secret-vault", () => ({
	parseExternalSecretKeyring: h.keyring, decryptExternalSecret: h.decrypt, encryptExternalSecret: h.encrypt,
}));
vi.mock("@/lib/email/external/oauth-provider", async (importOriginal) => ({
	...(await importOriginal<any>()), refreshExternalAccessToken: h.refresh,
}));
vi.mock("@/lib/email/external/provider-client", async (importOriginal) => ({
	...(await importOriginal<any>()), fetchGoogleSyncPage: h.google, fetchMicrosoftSyncPage: h.microsoft,
}));
vi.mock("@/lib/email/external/sync-page", () => ({
	applyExternalSyncPage: h.apply,
	readExternalSyncCursor: h.read,
}));

import { ExternalOAuthRefreshError } from "@/lib/email/external/oauth-provider";
import { ExternalProviderRequestError } from "@/lib/email/external/provider-client";
import {
	isExternalSyncQueueMessage,
	processExternalSyncQueue,
} from "@/lib/email/external/sync-queue";

const job = {
	id: "exj_1", accountId: "exa_1", kind: "initial" as const, status: "processing" as const,
	attempts: 1, nextAttemptAt: new Date(), leaseUntil: new Date(), errorCode: null,
	createdAt: new Date(), completedAt: null,
};
const account = {
	id: "exa_1", organizationId: "org_1", mailboxId: "mbx_1", ownerUserId: "usr_1",
	provider: "google" as const, externalAddress: "user@example.com", tokenCiphertext: "cipher",
	tokenIv: "iv", tokenKeyId: "v1", status: "initial_sync" as const, importMode: "from_now" as const,
	retainOriginal: false, mailboxUserId: "usr_mailbox", mailboxOrganizationId: "org_1",
	mailboxLocalPart: "support", mailboxDisplayName: "Support", mailboxHostname: "example.com",
};

describe("external sync queue", () => {
	let mock: DbMock;
	const env = { EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		h.keyring.mockReturnValue({ active: "v1", keys: { v1: "key" } });
		h.decrypt.mockResolvedValue("refresh-secret");
		h.encrypt.mockResolvedValue({ keyId: "v1", iv: "new-iv", ciphertext: "new-cipher" });
		h.refresh.mockResolvedValue({ accessToken: "access", refreshToken: "refresh-secret", expiresIn: 3600, scope: "scope" });
		h.google.mockResolvedValue({ changes: [], cursor: { historyId: "500" }, hasMore: false });
		h.microsoft.mockResolvedValue({ changes: [], cursor: { url: "https://graph.microsoft.com/delta", complete: true }, hasMore: false });
		h.apply.mockResolvedValue([{ status: "created", messageId: "msg_1" }]);
		h.read.mockResolvedValue(undefined);
	});

	it("strictly recognizes versioned content-free queue messages", () => {
		expect(isExternalSyncQueueMessage({ kind: "external-sync", version: 1, jobId: "exj_1" })).toBe(true);
		for (const value of [null, {}, { kind: "external-sync", version: 2, jobId: "x" },
			{ kind: "external-sync", version: 1, jobId: "" }, { kind: "external-sync", version: 1, jobId: "x", token: "secret" }]) {
			expect(isExternalSyncQueueMessage(value)).toBe(false);
		}
	});

	it("claims, refreshes, imports, commits cursor, and activates a Google account", async () => {
		mock.queueSelect([job]).queueSelect([account]);
		h.google.mockResolvedValue({
			changes: [{ remoteMessageId: "g1", remoteFolderKey: "inbox", removed: false, rawMime: new Uint8Array([1]) }],
			cursor: { historyId: "501" }, hasMore: false,
		});
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" },
			new Date("2026-08-15T12:00:00Z"))).toEqual({ action: "ack" });
		expect(h.apply).toHaveBeenCalledWith(env, expect.objectContaining({ id: "exa_1" }),
			expect.objectContaining({ id: "mbx_1", hostname: "example.com" }),
			[expect.objectContaining({ remoteMessageId: "g1" })],
			[{ key: "gmail", type: "gmail_history", value: { historyId: "501" } }],
			expect.any(Date));
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({ status: "active", lastErrorCode: null }));
	});

	it("syncs each Microsoft MVP folder and retries bounded continuation pages", async () => {
		mock.queueSelect([job]).queueSelect([{ ...account, provider: "microsoft", importMode: "recent_30_days" }])
			.queueSelect([]).queueSelect([]).queueSelect([]);
		h.microsoft.mockResolvedValueOnce({ changes: [], cursor: { url: "https://graph.microsoft.com/next", complete: false }, hasMore: true })
			.mockResolvedValue({ changes: [], cursor: { url: "https://graph.microsoft.com/delta", complete: true }, hasMore: false });
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "retry", delaySeconds: 1 });
		expect(h.microsoft.mock.calls.map((call) => call[0].folder)).toEqual(["inbox", "sent", "archive"]);
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({ status: "pending" }));
	});

	it("acks already claimed/missing work and terminally refuses paused accounts", async () => {
		mock.queueSelect([]);
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		mock.queueSelect([job]).queueSelect([{ ...account, status: "paused" }]);
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(h.refresh).not.toHaveBeenCalled();
		mock.queueSelect([job]).queueSelect([]);
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
	});

	it("marks authorization loss for reconnect and cursor loss for explicit resync", async () => {
		mock.queueSelect([job]).queueSelect([account]);
		h.refresh.mockRejectedValue(new ExternalOAuthRefreshError("authorization_revoked", false));
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({ status: "reconnect_required" }));

		mock.queueSelect([job]).queueSelect([account]);
		h.refresh.mockResolvedValue({ accessToken: "access", refreshToken: "refresh-secret", expiresIn: 3600, scope: "scope" });
		h.google.mockRejectedValue(new ExternalProviderRequestError("cursor_expired", false));
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({ status: "resync_required" }));
	});

	it("retries typed credential throttling and terminally records other credential failures", async () => {
		const random = vi.spyOn(Math, "random").mockReturnValue(0);
		mock.queueSelect([job]).queueSelect([account]);
		h.refresh.mockRejectedValueOnce(new ExternalOAuthRefreshError("provider_throttled", true));
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "retry", delaySeconds: 30 });
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({
			status: "pending", errorCode: "provider_throttled",
		}));

		mock.queueSelect([job]).queueSelect([account]);
		h.refresh.mockRejectedValueOnce(new Error("credential subsystem failed"));
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({
			status: "error", lastErrorCode: "EXTERNAL_AUTH",
		}));
		random.mockRestore();
	});

	it("retries transient provider faults and persists rotated refresh tokens", async () => {
		const random = vi.spyOn(Math, "random").mockReturnValue(0);
		mock.queueSelect([job]).queueSelect([account]);
		h.refresh.mockResolvedValue({ accessToken: "access", refreshToken: "rotated", expiresIn: 3600, scope: "scope" });
		h.google.mockRejectedValue(new ExternalProviderRequestError("provider_throttled", true));
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "retry", delaySeconds: 30 });
		expect(h.encrypt).toHaveBeenCalledWith("rotated", expect.stringContaining("external-account:exa_1"), expect.anything());
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({ tokenCiphertext: "new-cipher" }));
		random.mockRestore();
	});

	it("decrypts validated cursors, runs incremental mode, and marks corrupt cursors for resync", async () => {
		mock.queueSelect([{ ...job, kind: "incremental" }]).queueSelect([{ ...account, status: "active" }]);
		h.read.mockResolvedValueOnce({ historyId: "500" });
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(h.google).toHaveBeenCalledWith(
			expect.objectContaining({ mode: "incremental", cursor: { historyId: "500" } }),
			fetch,
		);

		mock.queueSelect([{ ...job, kind: "incremental" }]).queueSelect([{ ...account, status: "active" }]);
		h.read.mockRejectedValueOnce(new ExternalProviderRequestError("cursor_expired", false));
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({ status: "resync_required" }));

		mock.queueSelect([{ ...job, kind: "incremental" }]).queueSelect([{ ...account, status: "active" }]);
		h.read.mockResolvedValueOnce({ bad: true });
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
	});

	it("resyncs without stale cursors and imports Microsoft changes", async () => {
		mock.queueSelect([{ ...job, kind: "resync" }]).queueSelect([{ ...account, provider: "microsoft", status: "resync_required" }]);
		h.microsoft.mockResolvedValue({
			changes: [{ remoteMessageId: "m1", remoteFolderKey: "inbox", removed: false, rawMime: new Uint8Array([1]) }],
			cursor: { url: "https://graph.microsoft.com/delta", complete: true }, hasMore: false,
		});
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(h.microsoft).toHaveBeenCalledWith(expect.objectContaining({ cursor: undefined }), fetch, expect.any(Date));
		expect(h.apply).toHaveBeenCalledWith(env, expect.anything(), expect.anything(),
			expect.arrayContaining([expect.objectContaining({ remoteMessageId: "m1" })]),
			expect.arrayContaining([expect.objectContaining({ type: "microsoft_delta" })]), expect.any(Date));

		mock.queueSelect([{ ...job, kind: "resync" }]).queueSelect([{ ...account, status: "resync_required" }]);
		h.google.mockResolvedValue({ changes: [], cursor: { historyId: "800" }, hasMore: false });
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(h.google).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: undefined }), fetch);
	});

	it("terminally classifies unexpected and nonretryable provider failures", async () => {
		mock.queueSelect([job]).queueSelect([account]);
		h.google.mockRejectedValue(new ExternalProviderRequestError("invalid_provider_response", false));
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({ status: "error", lastErrorCode: "invalid_provider_response" }));
		mock.queueSelect([job]).queueSelect([account]);
		h.google.mockRejectedValue(new Error("unexpected"));
		expect(await processExternalSyncQueue(env, { kind: "external-sync", version: 1, jobId: "exj_1" }))
			.toEqual({ action: "ack" });
		expect(mock.updates.map((update) => update.set)).toContainEqual(expect.objectContaining({ lastErrorCode: "sync_failed" }));
	});

});
