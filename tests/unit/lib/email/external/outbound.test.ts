import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../helpers/db";

const h = vi.hoisted(() => ({
	db: null as unknown, keyring: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(), refresh: vi.fn(),
	createMime: vi.fn(),
}));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/external/secret-vault", () => ({
	parseExternalSecretKeyring: h.keyring, decryptExternalSecret: h.decrypt, encryptExternalSecret: h.encrypt,
}));
vi.mock("@/lib/email/external/oauth-provider", async (importOriginal) => ({
	...(await importOriginal<any>()), refreshExternalAccessToken: h.refresh,
}));
vi.mock("mimetext", () => ({ createMimeMessage: h.createMime }));

import {
	resolveExternalSenderAuthorization,
	sendExternalProviderMessage,
	ExternalSenderNotAllowedError,
} from "@/lib/email/external/outbound";
import { ExternalOAuthRefreshError } from "@/lib/email/external/oauth-provider";

const account = {
	id: "exa_1", organizationId: "org_1", mailboxId: "mbx_1", ownerUserId: "usr_owner",
	provider: "google" as const, externalAddress: "person@gmail.com", tokenCiphertext: "cipher",
	tokenIv: "iv", tokenKeyId: "v1", status: "active" as const,
	localPart: "support", hostname: "example.com", displayName: "Support",
	role: "responder" as const,
};
const message = {
	from: "person@gmail.com", to: "target@example.com", subject: "Hi", text: "Plain", html: "<p>HTML</p>",
	headers: { "In-Reply-To": "<parent@example.com>", References: "<parent@example.com>" },
	attachments: [{ filename: "a.txt", contentType: "text/plain", size: 3, content: new Uint8Array([1, 2, 3]).buffer, disposition: "attachment" as const }],
};

describe("external provider outbound", () => {
	let mock: DbMock;
	let mime: Record<string, ReturnType<typeof vi.fn>>;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		h.keyring.mockReturnValue({ active: "v1", keys: { v1: "key" } });
		h.decrypt.mockResolvedValue("refresh-secret");
		h.encrypt.mockResolvedValue({ keyId: "v2", iv: "new-iv", ciphertext: "new-cipher" });
		h.refresh.mockResolvedValue({ accessToken: "access", refreshToken: "refresh-secret", expiresIn: 3600, scope: "scope" });
		mime = {
			setSender: vi.fn(), setRecipients: vi.fn(), setSubject: vi.fn(), addMessage: vi.fn(),
			setHeader: vi.fn(), addAttachment: vi.fn(), asRaw: vi.fn(() => "Message-ID: <generated@example.com>\r\n\r\nBody"),
		};
		h.createMime.mockReturnValue(mime);
	});

	it("authorizes an active connection only through live mailbox send capability", async () => {
		mock.queueSelect([account]);
		expect(await resolveExternalSenderAuthorization({} as CloudflareEnv, "usr_1", "exa_1", "person@gmail.com", "mbx_1"))
			.toEqual({
				mailboxId: "mbx_1", organizationId: "org_1", localPart: "support", hostname: "example.com",
				displayName: "Support", externalAddress: "person@gmail.com", externalAccountId: "exa_1",
			});
		mock.queueSelect([{ ...account, role: "viewer" }]);
		expect(await resolveExternalSenderAuthorization({} as CloudflareEnv, "usr_1", "exa_1", "person@gmail.com")).toBeNull();
		mock.queueSelect([{ ...account, status: "paused" }]);
		expect(await resolveExternalSenderAuthorization({} as CloudflareEnv, "usr_1", "exa_1", "person@gmail.com")).toBeNull();
		mock.queueSelect([account]);
		expect(await resolveExternalSenderAuthorization({} as CloudflareEnv, "usr_1", "exa_1", "other@gmail.com")).toBeNull();
		mock.queueSelect([account]);
		expect(await resolveExternalSenderAuthorization({} as CloudflareEnv, "usr_1", "exa_1", "person@gmail.com", "mbx_other")).toBeNull();
	});

	it("builds MIME and sends through Gmail messages.send with no token in payload", async () => {
		mock.queueSelect([account]);
		const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			void input;
			void init;
			return Response.json({ id: "gmail_remote", threadId: "gmail_thread" });
		});
		expect(await sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message, fetcher)).toEqual({ providerMessageId: "gmail_remote" });
		expect(mime.setSender).toHaveBeenCalledWith("person@gmail.com");
		expect(mime.addAttachment).toHaveBeenCalledWith(expect.objectContaining({ filename: "a.txt", data: "AQID" }));
		const [url, options] = fetcher.mock.calls[0];
		expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
		expect(new Headers(options?.headers).get("authorization")).toBe("Bearer access");
		expect(JSON.parse(options?.body as string).raw).not.toContain("refresh-secret");
	});

	it("sends MIME through Microsoft Graph and uses its RFC Message-ID for reconciliation", async () => {
		mock.queueSelect([{ ...account, provider: "microsoft" }]);
		const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
		expect(await sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", { ...message, attachments: undefined }, fetcher))
			.toEqual({ providerMessageId: "<generated@example.com>" });
		expect(fetcher).toHaveBeenCalledWith("https://graph.microsoft.com/v1.0/me/sendMail", expect.objectContaining({
			method: "POST", body: btoa("Message-ID: <generated@example.com>\r\n\r\nBody"),
		}));
	});

	it("fails closed on revoked live access, provider errors, invalid success, and refresh rotation", async () => {
		mock.queueSelect([]);
		await expect(sendExternalProviderMessage({} as CloudflareEnv, "usr_1", "exa_1", message))
			.rejects.toBeInstanceOf(ExternalSenderNotAllowedError);
		mock.queueSelect([account]);
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message, async () => new Response("secret", { status: 429 })))
			.rejects.toMatchObject({ retryable: true, code: "EXTERNAL_HTTP_429" });
		mock.queueSelect([account]);
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message, async () => Response.json({})))
			.rejects.toMatchObject({ retryable: false, code: "EXTERNAL_INVALID_RESPONSE" });
		mock.queueSelect([account]);
		h.refresh.mockResolvedValue({ accessToken: "access", refreshToken: "rotated", expiresIn: 3600, scope: "scope" });
		await sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", { ...message, attachments: undefined }, async () => Response.json({ id: "g1" }));
		expect(mock.updates.at(-1)?.set).toMatchObject({ tokenCiphertext: expect.any(String) });
	});

	it("maps refresh authorization loss, transient refresh faults, and nested Drizzle joins", async () => {
		mock.queueSelect([{ external_accounts: account, mailbox_memberships: { role: "responder" } }]);
		h.refresh.mockRejectedValue(new ExternalOAuthRefreshError("authorization_revoked", false));
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message)).rejects.toMatchObject({ code: "authorization_revoked", retryable: false });
		expect(mock.updates.at(-1)?.set).toMatchObject({ status: "reconnect_required" });

		mock.queueSelect([account]);
		h.refresh.mockRejectedValue(new ExternalOAuthRefreshError("provider_throttled", true));
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message)).rejects.toMatchObject({ code: "provider_throttled", retryable: true });
		mock.queueSelect([account]);
		h.refresh.mockRejectedValue(new Error("unexpected"));
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message)).rejects.toMatchObject({ code: "EXTERNAL_AUTH", retryable: false });
	});

	it("covers bounded MIME optionals and terminal provider response failures", async () => {
		mock.queueSelect([account]);
		await sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", { ...message, attachments: [{
				...message.attachments[0], disposition: "inline", contentId: "logo@example.com",
			}] }, async () => Response.json({ id: "g-inline" }));
		expect(mime.addAttachment).toHaveBeenCalledWith(expect.objectContaining({
			inline: true, headers: { "Content-ID": "logo@example.com" },
		}));
		mock.queueSelect([account]);
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", { from: "person@gmail.com", to: "target@example.com", subject: "Bare" },
			async () => new Response("bad json", { status: 200 })))
			.rejects.toMatchObject({ code: "EXTERNAL_INVALID_RESPONSE" });
		mock.queueSelect([account]);
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message, async () => new Response("denied", { status: 400 })))
			.rejects.toMatchObject({ code: "EXTERNAL_HTTP_400", retryable: false });
		mock.queueSelect([account]);
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message, async () => new Response("down", { status: 503 })))
			.rejects.toMatchObject({ code: "EXTERNAL_HTTP_503", retryable: true });
		mock.queueSelect([{ ...account, provider: "microsoft" }]);
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message, async () => new Response("down", { status: 503 })))
			.rejects.toMatchObject({ code: "EXTERNAL_HTTP_503", retryable: true });
		mock.queueSelect([{ ...account, provider: "microsoft" }]);
		mime.asRaw.mockReturnValue("Subject: no id\r\n\r\nBody");
		await expect(sendExternalProviderMessage({ EXTERNAL_TOKEN_KEYS: "keys" } as CloudflareEnv,
			"usr_1", "exa_1", message, async () => new Response(null, { status: 202 })))
			.rejects.toMatchObject({ code: "EXTERNAL_INVALID_MESSAGE" });
	});
});
