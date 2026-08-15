import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	values: vi.fn(),
	access: vi.fn(),
	pkce: vi.fn(),
	stateToken: vi.fn(),
	seal: vi.fn(),
	keyring: vi.fn(),
	buildUrl: vi.fn(),
	hash: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => ({ insert: () => ({ values: h.values }) }) }));
vi.mock("@/lib/auth/mailbox-access", () => ({ getMailboxAccess: h.access }));
vi.mock("@/lib/email/external/oauth-provider", () => ({
	createPkcePair: h.pkce,
	createExternalOauthStateToken: h.stateToken,
	buildExternalAuthorizationUrl: h.buildUrl,
}));
vi.mock("@/lib/email/external/secret-vault", () => ({
	parseExternalSecretKeyring: h.keyring,
	encryptExternalSecret: h.seal,
}));
vi.mock("@/lib/crypto-utils", () => ({ sha256Hex: h.hash }));
vi.mock("@/lib/ids", () => ({ newId: () => "eos_1" }));

import { beginExternalOAuth } from "@/lib/email/external/connections";

const input = {
	userId: "usr_1",
	organizationId: "org_1",
	sessionId: "sess_1",
	provider: "google" as const,
	mailboxId: "mbx_1",
	importMode: "from_now" as const,
	retainOriginal: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "manager" });
	h.pkce.mockResolvedValue({ verifier: "verifier-secret", challenge: "challenge" });
	h.stateToken.mockReturnValue("state-secret");
	h.hash.mockResolvedValue("state-hash");
	h.keyring.mockReturnValue({ active: "v1", keys: { v1: "key" } });
	h.seal.mockResolvedValue({ keyId: "v1", iv: "iv", ciphertext: "ciphertext" });
	h.buildUrl.mockReturnValue("https://accounts.google.com/auth?state=state-secret");
	h.values.mockResolvedValue(undefined);
});

describe("beginExternalOAuth", () => {
	it("requires live mailbox management capability", async () => {
		h.access.mockResolvedValue({ mailboxId: "mbx_1", organizationId: "org_1", role: "responder" });
		expect(await beginExternalOAuth({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv, input))
			.toEqual({ status: "forbidden" });
		h.access.mockResolvedValue(null);
		expect(await beginExternalOAuth({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv, input))
			.toEqual({ status: "forbidden" });
		expect(h.values).not.toHaveBeenCalled();
	});

	it("stores only a state digest and encrypted PKCE verifier", async () => {
		const now = new Date("2026-08-15T19:00:00.000Z");
		expect(await beginExternalOAuth({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv, input, now))
			.toEqual({ status: "created", redirectTo: "https://accounts.google.com/auth?state=state-secret" });
		expect(h.seal).toHaveBeenCalledWith("verifier-secret", "oauth-state:eos_1", expect.anything());
		expect(h.values).toHaveBeenCalledWith({
			id: "eos_1",
			stateHash: "state-hash",
			organizationId: "org_1",
			mailboxId: "mbx_1",
			userId: "usr_1",
			approvingSessionId: "sess_1",
			provider: "google",
			importMode: "from_now",
			retainOriginal: true,
			verifierCiphertext: "ciphertext",
			verifierIv: "iv",
			verifierKeyId: "v1",
			expiresAt: new Date("2026-08-15T19:10:00.000Z"),
			createdAt: now,
		});
		expect(JSON.stringify(h.values.mock.calls[0][0])).not.toContain("state-secret");
		expect(JSON.stringify(h.values.mock.calls[0][0])).not.toContain("verifier-secret");
		expect(h.buildUrl).toHaveBeenCalledWith(expect.anything(), "google", {
			state: "state-secret", codeChallenge: "challenge",
		});
	});

	it("binds a reconnect target into the one-time OAuth state", async () => {
		await beginExternalOAuth({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv, {
			...input, reconnectAccountId: "exa_existing",
		});
		expect(h.values).toHaveBeenCalledWith(expect.objectContaining({ reconnectAccountId: "exa_existing" }));
	});
});
