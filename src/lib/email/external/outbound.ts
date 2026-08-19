import { and, eq, inArray } from "drizzle-orm";
import { createMimeMessage } from "mimetext";
import { getDb } from "@/db";
import { domains, externalAccounts, mailboxMemberships, mailboxes } from "@/db/schema";
import { getEmailAddress } from "@/lib/email/address";
import { encodeBase64Attachment } from "@/lib/email/outbound-attachments";
import type { OutboundMessage, OutboundSendResult } from "@/lib/email/providers/types";
import { OutboundProviderError } from "@/lib/email/providers/types";
import { refreshExternalAccountCredential } from "./credentials";
import { getExternalProviderAdapter } from "./provider-adapter";

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
	const credential = await refreshExternalAccountCredential(env, external);
	if (credential.status === "error") {
		if (credential.revoked) {
			await db.update(externalAccounts).set({
				status: "reconnect_required", lastErrorCode: credential.code, updatedAt: new Date(),
			}).where(eq(externalAccounts.id, external.id));
		}
		throw new OutboundProviderError("External provider authorization failed", {
			code: credential.code,
			retryable: credential.retryable,
			cause: credential.cause,
		});
	}
	const raw = buildMime(message);
	return getExternalProviderAdapter(external.provider)
		.sendMessage(credential.accessToken, raw, fetcher);
}
