import { and, eq, inArray } from "drizzle-orm";
import { createMimeMessage } from "mimetext";
import { getDb } from "@/db";
import { domains, externalAccounts, mailboxMemberships, mailboxes } from "@/db/schema";
import { getEmailAddress } from "@/lib/email/address";
import { encodeBase64Attachment } from "@/lib/email/outbound-attachments";
import type { OutboundMessage, OutboundSendResult } from "@/lib/email/providers/types";
import { OutboundProviderError } from "@/lib/email/providers/types";
import { ExternalOAuthRefreshError, refreshExternalAccessToken } from "./oauth-provider";
import { decryptExternalSecret, encryptExternalSecret, parseExternalSecretKeyring } from "./secret-vault";

type ExternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ExternalSenderAuthorization = {
	mailboxId: string;
	organizationId: string;
	localPart: string;
	hostname: string;
	displayName: string | null;
	externalAddress: string;
	externalAccountId: string;
};

export class ExternalSenderNotAllowedError extends Error {
	constructor() {
		super("External sender is not active or allowed for this mailbox");
		this.name = "ExternalSenderNotAllowedError";
	}
}

export async function resolveExternalSenderAuthorization(
	env: CloudflareEnv,
	userId: string,
	externalAccountId: string,
	from: string,
	mailboxId?: string,
): Promise<ExternalSenderAuthorization | null> {
	const [row] = await getDb(env).select({
		id: externalAccounts.id,
		organizationId: externalAccounts.organizationId,
		mailboxId: externalAccounts.mailboxId,
		externalAddress: externalAccounts.externalAddress,
		status: externalAccounts.status,
		localPart: mailboxes.localPart,
		hostname: domains.hostname,
		displayName: mailboxes.displayName,
		role: mailboxMemberships.role,
	}).from(externalAccounts)
		.innerJoin(mailboxes, eq(mailboxes.id, externalAccounts.mailboxId))
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.innerJoin(mailboxMemberships, and(
			eq(mailboxMemberships.mailboxId, externalAccounts.mailboxId),
			eq(mailboxMemberships.userId, userId),
		))
		.where(eq(externalAccounts.id, externalAccountId))
		.limit(1);
	if (!row || row.status !== "active" || !["responder", "manager"].includes(row.role)) return null;
	if (mailboxId && mailboxId !== row.mailboxId) return null;
	if (getEmailAddress(from).toLowerCase() !== row.externalAddress.toLowerCase()) return null;
	return {
		mailboxId: row.mailboxId,
		organizationId: row.organizationId,
		localPart: row.localPart,
		hostname: row.hostname,
		displayName: row.displayName,
		externalAddress: row.externalAddress,
		externalAccountId: row.id,
	};
}

function accountSecretAad(account: {
	id: string;
	organizationId: string;
	mailboxId: string;
	ownerUserId: string;
	provider: string;
}): string {
	return `external-account:${account.id}:${account.organizationId}:${account.mailboxId}:${account.ownerUserId}:${account.provider}`;
}

function encodeBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function encodeBase64Url(value: string): string {
	return encodeBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildMime(message: OutboundMessage): string {
	const mime = createMimeMessage();
	mime.setSender(message.from);
	mime.setRecipients(message.to);
	mime.setSubject(message.subject);
	if (message.text !== undefined) mime.addMessage({ contentType: "text/plain", data: message.text });
	if (message.html !== undefined) mime.addMessage({ contentType: "text/html", data: message.html });
	for (const [name, value] of Object.entries(message.headers ?? {})) mime.setHeader(name, value);
	for (const attachment of message.attachments ?? []) {
		mime.addAttachment({
			filename: attachment.filename,
			contentType: attachment.contentType,
			data: encodeBase64Attachment(attachment.content),
			...(attachment.disposition === "inline"
				? { inline: true, headers: { "Content-ID": attachment.contentId as string } }
				: {}),
		});
	}
	return mime.asRaw();
}

function externalProviderFailure(status: number): OutboundProviderError {
	return new OutboundProviderError(`External provider send failed (${status})`, {
		code: `EXTERNAL_HTTP_${status}`,
		retryable: status === 429 || status >= 500,
	});
}

export async function sendExternalProviderMessage(
	env: CloudflareEnv,
	userId: string,
	externalAccountId: string,
	message: OutboundMessage,
	fetcher: ExternalFetch = fetch,
): Promise<OutboundSendResult> {
	const db = getDb(env);
	const [account] = await db.select().from(externalAccounts)
		.innerJoin(mailboxMemberships, and(
			eq(mailboxMemberships.mailboxId, externalAccounts.mailboxId),
			eq(mailboxMemberships.userId, userId),
			inArray(mailboxMemberships.role, ["responder", "manager"]),
		))
		.where(and(
			eq(externalAccounts.id, externalAccountId),
			eq(externalAccounts.status, "active"),
		)).limit(1);
	const external = account && "external_accounts" in account
		? account.external_accounts
		: account;
	if (!external || getEmailAddress(message.from).toLowerCase() !== external.externalAddress.toLowerCase()) {
		throw new ExternalSenderNotAllowedError();
	}
	const keyring = parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS);
	const aad = accountSecretAad(external);
	const refreshToken = await decryptExternalSecret({
		keyId: external.tokenKeyId,
		iv: external.tokenIv,
		ciphertext: external.tokenCiphertext,
	}, aad, keyring);
	let tokens;
	try {
		tokens = await refreshExternalAccessToken(env, external.provider, refreshToken);
	} catch (error) {
		if (error instanceof ExternalOAuthRefreshError && error.code === "authorization_revoked") {
			await db.update(externalAccounts).set({
				status: "reconnect_required", lastErrorCode: error.code, updatedAt: new Date(),
			}).where(eq(externalAccounts.id, external.id));
		}
		throw new OutboundProviderError("External provider authorization failed", {
			code: error instanceof ExternalOAuthRefreshError ? error.code : "EXTERNAL_AUTH",
			retryable: error instanceof ExternalOAuthRefreshError && error.retryable,
			cause: error,
		});
	}
	if (tokens.refreshToken !== refreshToken) {
		const sealed = await encryptExternalSecret(tokens.refreshToken, aad, keyring);
		await db.update(externalAccounts).set({
			tokenCiphertext: sealed.ciphertext,
			tokenIv: sealed.iv,
			tokenKeyId: sealed.keyId,
			updatedAt: new Date(),
		}).where(and(
			eq(externalAccounts.id, external.id),
			eq(externalAccounts.tokenCiphertext, external.tokenCiphertext),
		));
	}
	const raw = buildMime(message);
	if (external.provider === "google") {
		const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
			method: "POST",
			headers: { authorization: `Bearer ${tokens.accessToken}`, "content-type": "application/json" },
			body: JSON.stringify({ raw: encodeBase64Url(raw) }),
		});
		if (!response.ok) throw externalProviderFailure(response.status);
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new OutboundProviderError("External provider response was invalid", {
				code: "EXTERNAL_INVALID_RESPONSE", retryable: false,
			});
		}
		const id = body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string"
			? (body as { id: string }).id : null;
		if (!id) throw new OutboundProviderError("External provider response was invalid", {
			code: "EXTERNAL_INVALID_RESPONSE", retryable: false,
		});
		return { providerMessageId: id };
	}
	const response = await fetcher("https://graph.microsoft.com/v1.0/me/sendMail", {
		method: "POST",
		headers: {
			authorization: `Bearer ${tokens.accessToken}`,
			"content-type": "text/plain",
		},
		body: encodeBase64(raw),
	});
	if (!response.ok) throw externalProviderFailure(response.status);
	const messageId = /^Message-ID:\s*(<[^\r\n]+>)/im.exec(raw)?.[1];
	if (!messageId) throw new OutboundProviderError("Generated external message has no Message-ID", {
		code: "EXTERNAL_INVALID_MESSAGE", retryable: false,
	});
	return { providerMessageId: messageId };
}
