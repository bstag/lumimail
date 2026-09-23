import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	prepare: vi.fn(),
	cleanup: vi.fn(),
	keyring: vi.fn(),
	encrypt: vi.fn(),
	decrypt: vi.fn(),
	newId: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/external/import-message", () => ({ prepareExternalMessage: h.prepare }));
vi.mock("@/lib/email/attachment-storage", () => ({ cleanupAttachmentObjects: h.cleanup }));
vi.mock("@/lib/email/external/secret-vault", () => ({
	parseExternalSecretKeyring: h.keyring,
	encryptExternalSecret: h.encrypt,
	decryptExternalSecret: h.decrypt,
}));
vi.mock("@/lib/ids", () => ({ newId: h.newId }));

import { ExternalProviderRequestError, type ExternalRemoteChange } from "@/lib/email/external/provider-client";
import { applyExternalSyncPage, readExternalSyncCursor } from "@/lib/email/external/sync-page";

const account = {
	id: "exa_1", organizationId: "org_1", mailboxId: "mbx_1", ownerUserId: "usr_1",
	provider: "google" as const, retainOriginal: true,
};
const mailbox = {
	id: "mbx_1", userId: "usr_1", organizationId: "org_1", localPart: "support",
	displayName: "Support", hostname: "example.com",
};
const change = {
	remoteMessageId: "remote_1", remoteFolderKey: "inbox" as const, removed: false,
	rawMime: new Uint8Array([1]),
};

describe("external sync page application", () => {
	let mock: DbMock;
	const env = { EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		h.keyring.mockReturnValue({ active: "v1", keys: { v1: "key" } });
		h.encrypt.mockResolvedValue({ keyId: "v1", iv: "cursor-iv", ciphertext: "cursor-cipher" });
		h.decrypt.mockResolvedValue(JSON.stringify({ historyId: "500" }));
		h.newId.mockReturnValue("exc_1");
		h.cleanup.mockResolvedValue(undefined);
	});

	it("reads and parses an identity-bound cursor", async () => {
		mock.queueSelect([{
			cursorKeyId: "v1", cursorIv: "iv", cursorCiphertext: "cipher",
		}]);
		await expect(readExternalSyncCursor(env, "exa_1", "gmail"))
			.resolves.toEqual({ historyId: "500" });
		expect(h.decrypt).toHaveBeenCalledWith(
			{ keyId: "v1", iv: "iv", ciphertext: "cipher" },
			"external-cursor:exa_1:gmail",
			expect.anything(),
		);

		mock.queueSelect([]);
		await expect(readExternalSyncCursor(env, "exa_1", "gmail")).resolves.toBeUndefined();
	});

	it("classifies malformed stored cursor JSON as expired", async () => {
		mock.queueSelect([{ cursorKeyId: "v1", cursorIv: "iv", cursorCiphertext: "cipher" }]);
		h.decrypt.mockResolvedValue("not-json");
		await expect(readExternalSyncCursor(env, "exa_1", "gmail"))
			.rejects.toEqual(new ExternalProviderRequestError("cursor_expired", false));
	});

	it("commits deduplicated messages before the final cursor batch", async () => {
		const messageStatement = mock.db.update({}).set({ message: true });
		h.prepare.mockImplementation(async (
			_env: CloudflareEnv,
			_account: unknown,
			_mailbox: unknown,
			preparedChange: ExternalRemoteChange,
			_now: Date,
			attemptedKeys: string[],
		) => {
			attemptedKeys.push("r2/message.eml");
			return {
				statements: [messageStatement],
				result: { status: "created", messageId: preparedChange.remoteMessageId },
			};
		});

		await expect(applyExternalSyncPage(
			env,
			account,
			mailbox,
			[change, { ...change, remoteRevision: "latest" }],
			[{ key: "gmail", type: "gmail_history", value: { historyId: "501" } }],
			new Date("2026-08-19T12:00:00Z"),
		)).resolves.toEqual([{ status: "created", messageId: "remote_1" }]);
		expect(h.prepare).toHaveBeenCalledTimes(1);
		expect(mock.db.batch).toHaveBeenCalledTimes(2);
		expect(mock.db.batch.mock.calls[0][0]).toHaveLength(1);
		expect(mock.db.batch.mock.calls[1][0]).toHaveLength(1);
		expect(mock.inserts.at(-1)?.values).toEqual(expect.objectContaining({
			accountId: "exa_1", remoteFolderKey: "gmail", cursorType: "gmail_history",
		}));
		expect(h.cleanup).not.toHaveBeenCalled();
	});

	it("loads lazy MIME sequentially and does not retain page bodies between message batches", async () => {
		const events: string[] = [];
		let activeLoaders = 0;
		let maxActiveLoaders = 0;
		h.prepare.mockImplementation(async (
			_env: CloudflareEnv,
			_account: unknown,
			_mailbox: unknown,
			preparedChange: ExternalRemoteChange,
		) => {
			events.push(`prepare:${preparedChange.remoteMessageId}:${preparedChange.rawMime?.[0]}`);
			expect(preparedChange.loadRawMime).toBeUndefined();
			await Promise.resolve();
			events.push(`prepared:${preparedChange.remoteMessageId}`);
			return {
				statements: [mock.db.update({}).set({ message: preparedChange.remoteMessageId })],
				result: { status: "created", messageId: preparedChange.remoteMessageId },
			};
		});
		const lazyChange = (remoteMessageId: string, byte: number) => ({
			remoteMessageId,
			remoteFolderKey: "inbox" as const,
			removed: false,
			loadRawMime: async () => {
				activeLoaders++;
				maxActiveLoaders = Math.max(maxActiveLoaders, activeLoaders);
				events.push(`load:${remoteMessageId}`);
				await Promise.resolve();
				activeLoaders--;
				return new Uint8Array([byte]);
			},
		});

		await expect(applyExternalSyncPage(env, account, mailbox, [
			lazyChange("remote_1", 1), lazyChange("remote_2", 2),
		], [])).resolves.toEqual([
			{ status: "created", messageId: "remote_1" },
			{ status: "created", messageId: "remote_2" },
		]);
		expect(events).toEqual([
			"load:remote_1", "prepare:remote_1:1", "prepared:remote_1",
			"load:remote_2", "prepare:remote_2:2", "prepared:remote_2",
		]);
		expect(maxActiveLoaders).toBe(1);
		expect(mock.db.batch).toHaveBeenCalledTimes(2);
	});

	it("leaves the cursor unchanged after a late message failure and replays committed messages safely", async () => {
		const first = { ...change, remoteMessageId: "remote_1" };
		const second = { ...change, remoteMessageId: "remote_2" };
		h.prepare
			.mockResolvedValueOnce({
				statements: [mock.db.update({}).set({ message: "first" })],
				result: { status: "created", messageId: "remote_1" },
			})
			.mockRejectedValueOnce(new Error("late message failed"))
			.mockResolvedValueOnce({
				statements: [mock.db.update({}).set({ message: "existing-first" })],
				result: { status: "existing", messageId: "remote_1" },
			})
			.mockResolvedValueOnce({
				statements: [mock.db.update({}).set({ message: "second" })],
				result: { status: "created", messageId: "remote_2" },
			});

		await expect(applyExternalSyncPage(env, account, mailbox, [first, second], [
			{ key: "gmail", type: "gmail_history", value: { historyId: "501" } },
		])).rejects.toThrow("late message failed");
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
		expect(h.encrypt).not.toHaveBeenCalled();

		await expect(applyExternalSyncPage(env, account, mailbox, [first, second], [
			{ key: "gmail", type: "gmail_history", value: { historyId: "501" } },
		])).resolves.toEqual([
			{ status: "existing", messageId: "remote_1" },
			{ status: "created", messageId: "remote_2" },
		]);
		expect(mock.db.batch).toHaveBeenCalledTimes(4);
		expect(mock.db.batch.mock.calls.at(-1)?.[0]).toHaveLength(1);
	});

	it("compensates every prepared R2 object when the D1 batch fails", async () => {
		const statement = mock.db.update({}).set({ message: true });
		h.prepare.mockImplementation(async (
			_env: CloudflareEnv,
			_account: unknown,
			_mailbox: unknown,
			_change: unknown,
			_now: Date,
			attemptedKeys: string[],
		) => {
			attemptedKeys.push("r2/original.eml", "r2/attachment.bin");
			return { statements: [statement], result: { status: "created", messageId: "msg_1" } };
		});
		mock.db.batch.mockRejectedValue(new Error("D1 unavailable"));

		await expect(applyExternalSyncPage(env, account, mailbox, [change], []))
			.rejects.toThrow("D1 unavailable");
		expect(h.cleanup).toHaveBeenCalledWith(env, ["r2/original.eml", "r2/attachment.bin"]);
	});

	it("returns ignored outcomes without issuing an empty D1 batch", async () => {
		h.prepare.mockResolvedValue({ statements: [], result: { status: "ignored" } });
		await expect(applyExternalSyncPage(env, account, mailbox, [change], []))
			.resolves.toEqual([{ status: "ignored" }]);
		expect(mock.db.batch).not.toHaveBeenCalled();
	});
});
