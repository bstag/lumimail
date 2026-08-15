import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	returning: vi.fn(),
	insertValues: vi.fn((value: unknown) => value),
	batch: vi.fn(),
	access: vi.fn(),
	exchange: vi.fn(),
	identity: vi.fn(),
	keyring: vi.fn(),
	decrypt: vi.fn(),
	encrypt: vi.fn(),
	hash: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => ({
	update: () => ({ set: () => ({ where: () => ({ returning: h.returning }) }) }),
	insert: () => ({ values: h.insertValues }),
	batch: h.batch,
}) }));
vi.mock("@/lib/auth/mailbox-access", () => ({ getMailboxAccess: h.access }));
vi.mock("@/lib/email/external/oauth-provider", () => ({
	exchangeExternalAuthorizationCode: h.exchange,
	fetchExternalIdentity: h.identity,
}));
vi.mock("@/lib/email/external/secret-vault", () => ({
	parseExternalSecretKeyring: h.keyring,
	decryptExternalSecret: h.decrypt,
	encryptExternalSecret: h.encrypt,
}));
vi.mock("@/lib/crypto-utils", () => ({ sha256Hex: h.hash }));
vi.mock("@/lib/ids", () => ({ newId: (prefix: string) => `${prefix}_1` }));

import { completeExternalOAuth } from "@/lib/email/external/connections";

const stateRow = {
	id: "eos_1",
	stateHash: "state-hash",
	organizationId: "org_1",
	mailboxId: "mbx_1",
	userId: "usr_1",
	approvingSessionId: "sess_1",
	provider: "google" as const,
	importMode: "from_now" as const,
	retainOriginal: true,
	verifierCiphertext: "verifier-cipher",
	verifierIv: "verifier-iv",
	verifierKeyId: "v1",
	expiresAt: new Date("2026-08-15T19:10:00.000Z"),
	usedAt: new Date("2026-08-15T19:01:00.000Z"),
	createdAt: new Date("2026-08-15T19:00:00.000Z"),
};

const input = {
	userId: "usr_1",
	organizationId: "org_1",
	sessionId: "sess_1",
	state: "state-secret",
	code: "authorization-code",
};

beforeEach(() => {
	vi.clearAllMocks();
	h.returning.mockResolvedValue([stateRow]);
	h.hash.mockResolvedValue("state-hash");
	h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "manager" });
	h.keyring.mockReturnValue({ active: "v1", keys: { v1: "key" } });
	h.decrypt.mockResolvedValue("pkce-verifier");
	h.exchange.mockResolvedValue({
		accessToken: "access-secret", refreshToken: "refresh-secret", expiresIn: 3600, scope: "scope",
	});
	h.identity.mockResolvedValue("user@example.com");
	h.encrypt.mockResolvedValue({ keyId: "v1", iv: "token-iv", ciphertext: "token-cipher" });
	h.batch.mockResolvedValue(undefined);
});

describe("completeExternalOAuth", () => {
	it("atomically refuses missing, replayed, expired, or wrong-session state", async () => {
		h.returning.mockResolvedValue([]);
		expect(await completeExternalOAuth({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv, input))
			.toEqual({ status: "invalid-state" });
		expect(h.exchange).not.toHaveBeenCalled();
	});

	it("rechecks live mailbox manager capability after consuming state", async () => {
		h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "responder" });
		expect(await completeExternalOAuth({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv, input))
			.toEqual({ status: "forbidden" });
		expect(h.exchange).not.toHaveBeenCalled();
	});

	it("stores an encrypted refresh token and durable initial job before enqueueing", async () => {
		const send = vi.fn().mockResolvedValue(undefined);
		const now = new Date("2026-08-15T19:01:00.000Z");
		const env = { EXTERNAL_TOKEN_KEYS: "keys", EXTERNAL_SYNC_QUEUE: { send } } as unknown as CloudflareEnv;
		expect(await completeExternalOAuth(env, input, now)).toEqual({
			status: "created", accountId: "exa_1", externalAddress: "user@example.com",
		});
		expect(h.decrypt).toHaveBeenCalledWith({
			keyId: "v1", iv: "verifier-iv", ciphertext: "verifier-cipher",
		}, "oauth-state:eos_1", expect.anything());
		expect(h.exchange).toHaveBeenCalledWith(env, "google", "authorization-code", "pkce-verifier");
		expect(h.encrypt).toHaveBeenCalledWith(
			"refresh-secret", "external-account:exa_1:org_1:mbx_1:usr_1:google", expect.anything(),
		);
		expect(h.batch).toHaveBeenCalledWith([
			expect.objectContaining({
				id: "exa_1", organizationId: "org_1", mailboxId: "mbx_1", ownerUserId: "usr_1",
				approvingSessionId: "sess_1", provider: "google", externalAddress: "user@example.com",
				tokenCiphertext: "token-cipher", tokenIv: "token-iv", tokenKeyId: "v1",
				status: "initial_sync", importMode: "from_now", retainOriginal: true,
			}),
			expect.objectContaining({
				id: "exj_1", accountId: "exa_1", kind: "initial", status: "pending", attempts: 0,
			}),
		]);
		expect(JSON.stringify(h.batch.mock.calls[0][0])).not.toContain("access-secret");
		expect(JSON.stringify(h.batch.mock.calls[0][0])).not.toContain("refresh-secret");
		expect(send).toHaveBeenCalledWith({ kind: "external-sync", version: 1, jobId: "exj_1" });
	});

	it("leaves a committed job for reconciliation when queue send fails", async () => {
		const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const env = { EXTERNAL_TOKEN_KEYS: "keys", EXTERNAL_SYNC_QUEUE: { send } } as unknown as CloudflareEnv;
		expect(await completeExternalOAuth(env, input)).toMatchObject({ status: "created", accountId: "exa_1" });
		expect(warn).toHaveBeenCalledWith("External initial sync enqueue deferred", { jobId: "exj_1" });
		warn.mockRestore();
	});

	it("returns conflict for the same provider identity and mailbox", async () => {
		h.batch.mockRejectedValue(new Error("UNIQUE constraint failed: external_accounts.mailbox_id, external_accounts.provider, external_accounts.external_address"));
		expect(await completeExternalOAuth({ EXTERNAL_TOKEN_KEYS: "keys", EXTERNAL_SYNC_QUEUE: { send: vi.fn() } } as unknown as CloudflareEnv, input))
			.toEqual({ status: "conflict" });
	});

	it("propagates non-conflict persistence failures", async () => {
		h.batch.mockRejectedValue(new Error("D1 unavailable"));
		await expect(completeExternalOAuth({
			EXTERNAL_TOKEN_KEYS: "keys", EXTERNAL_SYNC_QUEUE: { send: vi.fn() },
		} as unknown as CloudflareEnv, input)).rejects.toThrow("D1 unavailable");
	});
});
