import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { externalAccounts } from "@/db/schema";
import { ExternalOAuthRefreshError } from "./oauth-provider";
import { getExternalProviderAdapter } from "./provider-adapter";
import {
	decryptExternalSecret,
	encryptExternalSecret,
	parseExternalSecretKeyring,
	type SealedExternalSecret,
} from "./secret-vault";
import type { ExternalProvider } from "./types";

export type ExternalAccountCredentialIdentity = {
	id: string;
	organizationId: string;
	mailboxId: string;
	ownerUserId: string;
	provider: ExternalProvider;
};

export type ExternalAccountCredential = ExternalAccountCredentialIdentity & {
	tokenCiphertext: string;
	tokenIv: string;
	tokenKeyId: string;
};

export type ExternalCredentialRefreshResult =
	| { status: "ready"; accessToken: string }
	| {
		status: "error";
		code: string;
		retryable: boolean;
		revoked: boolean;
		cause: unknown;
	};

function credentialContext(identity: ExternalAccountCredentialIdentity): string {
	return `external-account:${identity.id}:${identity.organizationId}:${identity.mailboxId}:${identity.ownerUserId}:${identity.provider}`;
}

export async function sealExternalAccountCredential(
	env: Pick<CloudflareEnv, "EXTERNAL_TOKEN_KEYS">,
	identity: ExternalAccountCredentialIdentity,
	refreshToken: string,
): Promise<SealedExternalSecret> {
	return encryptExternalSecret(
		refreshToken,
		credentialContext(identity),
		parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS),
	);
}

export async function openExternalAccountCredential(
	env: Pick<CloudflareEnv, "EXTERNAL_TOKEN_KEYS">,
	account: ExternalAccountCredential,
): Promise<string> {
	return decryptExternalSecret({
		keyId: account.tokenKeyId,
		iv: account.tokenIv,
		ciphertext: account.tokenCiphertext,
	}, credentialContext(account), parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS));
}

export async function refreshExternalAccountCredential(
	env: CloudflareEnv,
	account: ExternalAccountCredential,
	now = new Date(),
): Promise<ExternalCredentialRefreshResult> {
	const refreshToken = await openExternalAccountCredential(env, account);
	try {
		const tokens = await getExternalProviderAdapter(account.provider)
			.refreshAccessToken(env, refreshToken);
		if (tokens.refreshToken !== refreshToken) {
			const sealed = await sealExternalAccountCredential(env, account, tokens.refreshToken);
			await getDb(env).update(externalAccounts).set({
				tokenCiphertext: sealed.ciphertext,
				tokenIv: sealed.iv,
				tokenKeyId: sealed.keyId,
				updatedAt: now,
			}).where(and(
				eq(externalAccounts.id, account.id),
				eq(externalAccounts.tokenCiphertext, account.tokenCiphertext),
			));
		}
		return { status: "ready", accessToken: tokens.accessToken };
	} catch (error) {
		if (error instanceof ExternalOAuthRefreshError) {
			return {
				status: "error",
				code: error.code,
				retryable: error.retryable,
				revoked: error.code === "authorization_revoked",
				cause: error,
			};
		}
		return {
			status: "error",
			code: "EXTERNAL_AUTH",
			retryable: false,
			revoked: false,
			cause: error,
		};
	}
}
