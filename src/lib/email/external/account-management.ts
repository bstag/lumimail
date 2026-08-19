import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, externalAccounts, mailboxes, users } from "@/db/schema";
import { getMailboxAccess, listAccessibleMailboxIds } from "@/lib/auth/mailbox-access";
import { beginExternalOAuth } from "./connections";
import { openExternalAccountCredential } from "./credentials";
import { getExternalProviderAdapter } from "./provider-adapter";
import { requestExternalSyncJob } from "./sync-jobs";

type PublicExternalAccount = {
	id: string;
	mailboxId: string;
	mailboxAddress?: string;
	ownerUserId: string;
	ownerName?: string | null;
	provider: "google" | "microsoft";
	externalAddress: string;
	status: "connecting" | "initial_sync" | "active" | "paused" | "reconnect_required" |
		"resync_required" | "error" | "disconnected";
	importMode: "from_now" | "recent_30_days";
	retainOriginal: boolean;
	lastSyncAt: Date | null;
	lastErrorCode: string | null;
	createdAt: Date;
	updatedAt: Date;
	revokedAt: Date | null;
};

const publicSelection = {
	id: externalAccounts.id,
	mailboxId: externalAccounts.mailboxId,
	ownerUserId: externalAccounts.ownerUserId,
	provider: externalAccounts.provider,
	externalAddress: externalAccounts.externalAddress,
	status: externalAccounts.status,
	importMode: externalAccounts.importMode,
	retainOriginal: externalAccounts.retainOriginal,
	lastSyncAt: externalAccounts.lastSyncAt,
	lastErrorCode: externalAccounts.lastErrorCode,
	createdAt: externalAccounts.createdAt,
	updatedAt: externalAccounts.updatedAt,
	revokedAt: externalAccounts.revokedAt,
};

export async function listExternalAccounts(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
): Promise<PublicExternalAccount[]> {
	const db = getDb(env);
	const mailboxIds = await listAccessibleMailboxIds(db, userId, organizationId, "read");
	if (mailboxIds.length === 0) return [];
	const rows = await db
		.select({
			...publicSelection,
			mailboxLocalPart: mailboxes.localPart,
			mailboxHostname: domains.hostname,
			ownerName: users.name,
		})
		.from(externalAccounts)
		.innerJoin(mailboxes, eq(mailboxes.id, externalAccounts.mailboxId))
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.innerJoin(users, eq(users.id, externalAccounts.ownerUserId))
		.where(and(
			eq(externalAccounts.organizationId, organizationId),
			inArray(externalAccounts.mailboxId, mailboxIds),
		));
	return rows.map((row) => ({
		id: row.id,
		mailboxId: row.mailboxId,
		mailboxAddress: `${row.mailboxLocalPart}@${row.mailboxHostname}`,
		ownerUserId: row.ownerUserId,
		ownerName: row.ownerName,
		provider: row.provider,
		externalAddress: row.externalAddress,
		status: row.status,
		importMode: row.importMode,
		retainOriginal: row.retainOriginal,
		lastSyncAt: row.lastSyncAt,
		lastErrorCode: row.lastErrorCode,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		revokedAt: row.revokedAt,
	}));
}

async function findAccount(env: CloudflareEnv, organizationId: string, accountId: string) {
	const db = getDb(env);
	const [account] = await db.select().from(externalAccounts).where(and(
		eq(externalAccounts.id, accountId),
		eq(externalAccounts.organizationId, organizationId),
	)).limit(1);
	return account ?? null;
}

function toPublicAccount(account: typeof externalAccounts.$inferSelect): PublicExternalAccount {
	return {
		id: account.id,
		mailboxId: account.mailboxId,
		ownerUserId: account.ownerUserId,
		provider: account.provider,
		externalAddress: account.externalAddress,
		status: account.status,
		importMode: account.importMode,
		retainOriginal: account.retainOriginal,
		lastSyncAt: account.lastSyncAt,
		lastErrorCode: account.lastErrorCode,
		createdAt: account.createdAt,
		updatedAt: account.updatedAt,
		revokedAt: account.revokedAt,
	};
}

export async function getExternalAccount(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	accountId: string,
): Promise<PublicExternalAccount | null> {
	const account = await findAccount(env, organizationId, accountId);
	if (!account) return null;
	if (account.ownerUserId !== userId) {
		const access = await getMailboxAccess(getDb(env), userId, organizationId, account.mailboxId);
		if (access?.role !== "manager") return null;
	}
	return toPublicAccount(account);
}

async function findOwnedManagedAccount(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	accountId: string,
) {
	const account = await findAccount(env, organizationId, accountId);
	if (!account || account.ownerUserId !== userId) return null;
	const access = await getMailboxAccess(getDb(env), userId, organizationId, account.mailboxId);
	return access?.role === "manager" ? account : null;
}

export async function updateExternalAccount(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	accountId: string,
	change: { status?: "active" | "paused"; retainOriginal?: true },
	now = new Date(),
): Promise<{ status: "updated" | "not-found" | "conflict" }> {
	const account = await findOwnedManagedAccount(env, userId, organizationId, accountId);
	if (!account) return { status: "not-found" };
	if (account.status === "disconnected") return { status: "conflict" };
	if (change.status === "active" && account.status !== "paused") return { status: "conflict" };
	if (change.status === "paused" && account.status === "paused") return { status: "conflict" };
	const values: { status?: "active" | "paused"; retainOriginal?: true; updatedAt: Date; lastErrorCode?: null } = {
		updatedAt: now,
	};
	if (change.status) values.status = change.status;
	if (change.retainOriginal) values.retainOriginal = true;
	if (change.status === "active") values.lastErrorCode = null;
	await getDb(env).update(externalAccounts).set(values).where(and(
		eq(externalAccounts.id, account.id),
		eq(externalAccounts.ownerUserId, userId),
	));
	if (change.status === "active") await requestExternalSyncJob(env, account.id, "incremental", now);
	return { status: "updated" };
}

export async function disconnectExternalAccount(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	accountId: string,
	now = new Date(),
): Promise<{ status: "disconnected" | "not-found" | "conflict" }> {
	const account = await findOwnedManagedAccount(env, userId, organizationId, accountId);
	if (!account) return { status: "not-found" };
	if (account.status === "disconnected") return { status: "conflict" };
	const refreshToken = await openExternalAccountCredential(env, account);
	await getDb(env).update(externalAccounts).set({
		status: "disconnected",
		tokenCiphertext: "",
		tokenIv: "",
		tokenKeyId: "",
		lastErrorCode: null,
		updatedAt: now,
		revokedAt: now,
	}).where(and(eq(externalAccounts.id, account.id), eq(externalAccounts.ownerUserId, userId)));
	try {
		await getExternalProviderAdapter(account.provider).revokeRefreshToken(refreshToken);
	} catch {
		console.warn("External provider revocation attempt failed", { accountId: account.id });
	}
	return { status: "disconnected" };
}

export async function requestExternalAccountSync(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	accountId: string,
	now = new Date(),
): Promise<
	{ status: "accepted"; jobId: string } | { status: "not-found" } | { status: "conflict" }
> {
	const account = await findAccount(env, organizationId, accountId);
	if (!account) return { status: "not-found" };
	if (account.ownerUserId !== userId) {
		const access = await getMailboxAccess(getDb(env), userId, organizationId, account.mailboxId);
		if (access?.role !== "manager") return { status: "not-found" };
	}
	if (!["active", "resync_required", "error"].includes(account.status)) return { status: "conflict" };
	const kind = account.status === "active" ? "incremental" : "resync";
	const job = await requestExternalSyncJob(env, account.id, kind, now);
	return { status: "accepted", jobId: job.jobId };
}

export async function beginExternalAccountReconnect(
	env: CloudflareEnv,
	input: { userId: string; organizationId: string; sessionId: string; accountId: string },
): Promise<
	{ status: "created"; redirectTo: string } | { status: "not-found" } | { status: "conflict" }
> {
	const account = await findOwnedManagedAccount(
		env, input.userId, input.organizationId, input.accountId,
	);
	if (!account) return { status: "not-found" };
	if (account.status === "initial_sync" || account.status === "connecting") return { status: "conflict" };
	const result = await beginExternalOAuth(env, {
		userId: input.userId,
		organizationId: input.organizationId,
		sessionId: input.sessionId,
		provider: account.provider,
		mailboxId: account.mailboxId,
		importMode: account.importMode,
		retainOriginal: account.retainOriginal,
		reconnectAccountId: account.id,
	});
	return result.status === "created" ? result : { status: "not-found" };
}
