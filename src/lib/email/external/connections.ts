import { getDb } from "@/db";
import { externalAccounts, externalOauthStates, externalSyncJobs } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getMailboxAccess } from "@/lib/auth/mailbox-access";
import { sha256Hex } from "@/lib/crypto-utils";
import { newId } from "@/lib/ids";
import {
	buildExternalAuthorizationUrl,
	createExternalOauthStateToken,
	createPkcePair,
	exchangeExternalAuthorizationCode,
	fetchExternalIdentity,
} from "./oauth-provider";
import {
	decryptExternalSecret,
	encryptExternalSecret,
	parseExternalSecretKeyring,
} from "./secret-vault";
import type { ExternalImportMode, ExternalProvider } from "./types";

const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;

export type BeginExternalOAuthInput = {
	userId: string;
	organizationId: string;
	sessionId: string;
	provider: ExternalProvider;
	mailboxId: string;
	importMode: ExternalImportMode;
	retainOriginal: boolean;
};

export type BeginExternalOAuthResult =
	| { status: "forbidden" }
	| { status: "created"; redirectTo: string };

export async function beginExternalOAuth(
	env: CloudflareEnv,
	input: BeginExternalOAuthInput,
	now = new Date(),
): Promise<BeginExternalOAuthResult> {
	const db = getDb(env);
	const access = await getMailboxAccess(db, input.userId, input.organizationId, input.mailboxId);
	if (!access || access.role !== "manager") return { status: "forbidden" };

	const stateId = newId("eos");
	const state = createExternalOauthStateToken();
	const pkce = await createPkcePair();
	const keyring = parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS);
	const sealedVerifier = await encryptExternalSecret(pkce.verifier, `oauth-state:${stateId}`, keyring);

	await db.insert(externalOauthStates).values({
		id: stateId,
		stateHash: await sha256Hex(state),
		organizationId: input.organizationId,
		mailboxId: input.mailboxId,
		userId: input.userId,
		approvingSessionId: input.sessionId,
		provider: input.provider,
		importMode: input.importMode,
		retainOriginal: input.retainOriginal,
		verifierCiphertext: sealedVerifier.ciphertext,
		verifierIv: sealedVerifier.iv,
		verifierKeyId: sealedVerifier.keyId,
		expiresAt: new Date(now.getTime() + OAUTH_STATE_LIFETIME_MS),
		createdAt: now,
	});

	return {
		status: "created",
		redirectTo: buildExternalAuthorizationUrl(env, input.provider, {
			state,
			codeChallenge: pkce.challenge,
		}),
	};
}

export type CompleteExternalOAuthInput = {
	userId: string;
	organizationId: string;
	sessionId: string;
	state: string;
	code: string;
};

export type CompleteExternalOAuthResult =
	| { status: "invalid-state" | "forbidden" | "conflict" }
	| { status: "created"; accountId: string; externalAddress: string };

function isExistingConnectionConflict(error: unknown): boolean {
	return error instanceof Error && error.message.includes(
		"UNIQUE constraint failed: external_accounts.mailbox_id, external_accounts.provider, external_accounts.external_address",
	);
}

export async function completeExternalOAuth(
	env: CloudflareEnv,
	input: CompleteExternalOAuthInput,
	now = new Date(),
): Promise<CompleteExternalOAuthResult> {
	const db = getDb(env);
	const claimed = await db
		.update(externalOauthStates)
		.set({ usedAt: now })
		.where(and(
			eq(externalOauthStates.stateHash, await sha256Hex(input.state)),
			eq(externalOauthStates.userId, input.userId),
			eq(externalOauthStates.organizationId, input.organizationId),
			eq(externalOauthStates.approvingSessionId, input.sessionId),
			isNull(externalOauthStates.usedAt),
			gt(externalOauthStates.expiresAt, now),
		))
		.returning();
	const oauthState = claimed[0];
	if (!oauthState) return { status: "invalid-state" };

	const access = await getMailboxAccess(db, input.userId, input.organizationId, oauthState.mailboxId);
	if (!access || access.role !== "manager") return { status: "forbidden" };
	const keyring = parseExternalSecretKeyring(env.EXTERNAL_TOKEN_KEYS);
	const verifier = await decryptExternalSecret({
		keyId: oauthState.verifierKeyId,
		iv: oauthState.verifierIv,
		ciphertext: oauthState.verifierCiphertext,
	}, `oauth-state:${oauthState.id}`, keyring);
	const tokens = await exchangeExternalAuthorizationCode(
		env, oauthState.provider, input.code, verifier,
	);
	const externalAddress = await fetchExternalIdentity(oauthState.provider, tokens.accessToken);
	const accountId = newId("exa");
	const jobId = newId("exj");
	const sealedToken = await encryptExternalSecret(
		tokens.refreshToken,
		`external-account:${accountId}:${input.organizationId}:${oauthState.mailboxId}:${input.userId}:${oauthState.provider}`,
		keyring,
	);
	const accountInsert = db.insert(externalAccounts).values({
		id: accountId,
		organizationId: input.organizationId,
		mailboxId: oauthState.mailboxId,
		ownerUserId: input.userId,
		approvingSessionId: input.sessionId,
		provider: oauthState.provider,
		externalAddress,
		tokenCiphertext: sealedToken.ciphertext,
		tokenIv: sealedToken.iv,
		tokenKeyId: sealedToken.keyId,
		status: "initial_sync",
		importMode: oauthState.importMode,
		retainOriginal: oauthState.retainOriginal,
		createdAt: now,
		updatedAt: now,
	});
	const jobInsert = db.insert(externalSyncJobs).values({
		id: jobId,
		accountId,
		kind: "initial",
		status: "pending",
		attempts: 0,
		nextAttemptAt: now,
		createdAt: now,
	});
	try {
		await db.batch([accountInsert, jobInsert]);
	} catch (error) {
		if (isExistingConnectionConflict(error)) return { status: "conflict" };
		throw error;
	}
	try {
		await env.EXTERNAL_SYNC_QUEUE.send({ kind: "external-sync", version: 1, jobId });
	} catch {
		console.warn("External initial sync enqueue deferred", { jobId });
	}
	return { status: "created", accountId, externalAddress };
}
