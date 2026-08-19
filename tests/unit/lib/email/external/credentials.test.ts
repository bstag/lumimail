import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown,
	keyring: vi.fn(),
	encrypt: vi.fn(),
	decrypt: vi.fn(),
	refresh: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/external/secret-vault", () => ({
	parseExternalSecretKeyring: h.keyring,
	encryptExternalSecret: h.encrypt,
	decryptExternalSecret: h.decrypt,
}));
vi.mock("@/lib/email/external/oauth-provider", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/email/external/oauth-provider")>()),
	refreshExternalAccessToken: h.refresh,
}));

import { ExternalOAuthRefreshError } from "@/lib/email/external/oauth-provider";
import {
	openExternalAccountCredential,
	refreshExternalAccountCredential,
	sealExternalAccountCredential,
} from "@/lib/email/external/credentials";

const account = {
	id: "exa_1",
	organizationId: "org_1",
	mailboxId: "mbx_1",
	ownerUserId: "usr_1",
	provider: "google" as const,
	tokenCiphertext: "cipher",
	tokenIv: "iv",
	tokenKeyId: "v1",
};

describe("external account credential custody", () => {
	let mock: DbMock;
	const env = { EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		h.keyring.mockReturnValue({ active: "v1", keys: { v1: "key" } });
		h.encrypt.mockResolvedValue({ keyId: "v2", iv: "new-iv", ciphertext: "new-cipher" });
		h.decrypt.mockResolvedValue("refresh-secret");
		h.refresh.mockResolvedValue({
			accessToken: "access-token", refreshToken: "refresh-secret", expiresIn: 3600, scope: "mail",
		});
	});

	it("binds sealing and opening to the complete external account identity", async () => {
		await expect(sealExternalAccountCredential(env, account, "new-refresh"))
			.resolves.toEqual({ keyId: "v2", iv: "new-iv", ciphertext: "new-cipher" });
		expect(h.encrypt).toHaveBeenCalledWith(
			"new-refresh",
			"external-account:exa_1:org_1:mbx_1:usr_1:google",
			expect.anything(),
		);
		await expect(openExternalAccountCredential(env, account)).resolves.toBe("refresh-secret");
		expect(h.decrypt).toHaveBeenCalledWith(
			{ keyId: "v1", iv: "iv", ciphertext: "cipher" },
			"external-account:exa_1:org_1:mbx_1:usr_1:google",
			expect.anything(),
		);
	});

	it("returns access only and compare-and-set rotates a changed refresh credential", async () => {
		h.refresh.mockResolvedValue({
			accessToken: "access-token", refreshToken: "rotated", expiresIn: 3600, scope: "mail",
		});
		await expect(refreshExternalAccountCredential(env, account, new Date("2026-08-19T12:00:00Z")))
			.resolves.toEqual({ status: "ready", accessToken: "access-token" });
		expect(mock.updates.at(-1)?.set).toEqual(expect.objectContaining({
			tokenCiphertext: "new-cipher", tokenIv: "new-iv", tokenKeyId: "v2",
		}));
	});

	it("does not rewrite an unchanged refresh credential", async () => {
		await expect(refreshExternalAccountCredential(env, account))
			.resolves.toEqual({ status: "ready", accessToken: "access-token" });
		expect(mock.updates).toHaveLength(0);
	});

	it("returns typed revoked, retryable, and unexpected outcomes", async () => {
		const revoked = new ExternalOAuthRefreshError("authorization_revoked", false);
		h.refresh.mockRejectedValueOnce(revoked);
		await expect(refreshExternalAccountCredential(env, account)).resolves.toEqual({
			status: "error", code: "authorization_revoked", retryable: false, revoked: true, cause: revoked,
		});

		const throttled = new ExternalOAuthRefreshError("provider_throttled", true);
		h.refresh.mockRejectedValueOnce(throttled);
		await expect(refreshExternalAccountCredential(env, account)).resolves.toEqual({
			status: "error", code: "provider_throttled", retryable: true, revoked: false, cause: throttled,
		});

		const unexpected = new Error("broken");
		h.refresh.mockRejectedValueOnce(unexpected);
		await expect(refreshExternalAccountCredential(env, account)).resolves.toEqual({
			status: "error", code: "EXTERNAL_AUTH", retryable: false, revoked: false, cause: unexpected,
		});
	});
});
