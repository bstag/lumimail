import { and, count, desc, eq, gt, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
	pushDeliveries,
	pushDeviceMailboxes,
	pushDevices,
	securityAuditEvents,
	sessions,
} from "@/db/schema";
import { listAccessibleMailboxIds } from "@/lib/auth/mailbox-access";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { lookupSessionToken, verifySessionToken } from "@/lib/auth/session";
import { sha256Hex } from "@/lib/crypto-utils";
import { newId } from "@/lib/ids";

const ACTIVE_DEVICE_LIMIT = 10;

type PushSubscriptionInput = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

type DeviceActor = {
	userId: string;
	organizationId: string;
	requestId: string;
	now?: Date;
};

type DeviceMutation = DeviceActor & { deviceId: string };

function auditValues(
	args: DeviceActor,
	action: "push.register" | "push.rename" | "push.preferences" | "push.revoke",
	deviceId: string,
	now: Date,
) {
	return {
		id: newId("aud"),
		organizationId: args.organizationId,
		actorUserId: args.userId,
		action,
		resourceType: "push_device" as const,
		resourceId: deviceId,
		affectedCount: 1,
		requestId: args.requestId,
		outcome: "succeeded" as const,
		createdAt: now,
	};
}

async function readExactSession(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	token: string | undefined,
	now: Date,
) {
	if (!token) return null;
	const db = getDb(env);
	const [session] = await db
		.select({
			id: sessions.id,
			organizationId: sessions.organizationId,
			tokenHash: sessions.tokenHash,
		})
		.from(sessions)
		.where(and(
			eq(sessions.userId, userId),
			eq(sessions.organizationId, organizationId),
			eq(sessions.tokenLookup, await lookupSessionToken(token)),
			gt(sessions.expiresAt, now),
		))
		.limit(1);
	if (!session || !verifySessionToken(token, session.tokenHash)) return null;
	return session;
}

function publicDevice(
	row: {
		id: string;
		name: string;
		status: "active" | "revoked" | "expired";
		createdAt: Date;
		lastDeliveredAt: Date | null;
	},
	mailboxIds: string[],
	current: boolean,
) {
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		current,
		mailboxIds,
		createdAt: row.createdAt.toISOString(),
		lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null,
	};
}

export async function registerPushDevice(env: CloudflareEnv, args: DeviceActor & {
	sessionToken: string | undefined;
	name: string;
	subscription: PushSubscriptionInput;
}): Promise<
	| { status: "invalid-session" }
	| { status: "conflict" }
	| { status: "limit" }
	| { status: "created"; device: ReturnType<typeof publicDevice> }
	| { status: "updated"; device: ReturnType<typeof publicDevice> }
> {
	const now = args.now ?? new Date();
	const session = await readExactSession(env, args.userId, args.organizationId, args.sessionToken, now);
	if (!session) return { status: "invalid-session" };

	const db = getDb(env);
	const endpointHash = await sha256Hex(args.subscription.endpoint);
	const existingCandidates = await db
		.select({
			id: pushDevices.id,
			userId: pushDevices.userId,
			organizationId: pushDevices.organizationId,
			approvingSessionId: pushDevices.approvingSessionId,
			endpointHash: pushDevices.endpointHash,
			createdAt: pushDevices.createdAt,
			lastDeliveredAt: pushDevices.lastDeliveredAt,
		})
		.from(pushDevices)
		.where(and(
			eq(pushDevices.status, "active"),
			or(
				eq(pushDevices.endpointHash, endpointHash),
				eq(pushDevices.approvingSessionId, session.id),
			),
		))
		;
	const existing = existingCandidates.find((candidate) => candidate.approvingSessionId === session.id);
	if (existingCandidates.some((candidate) => candidate.id !== existing?.id)) {
		return { status: "conflict" };
	}

	if (existing) {
		if (existing.userId !== args.userId || existing.organizationId !== args.organizationId) {
			return { status: "conflict" };
		}
		await db.batch([
			db.update(pushDevices).set({
				name: args.name,
				endpoint: args.subscription.endpoint,
				endpointHash,
				p256dh: args.subscription.keys.p256dh,
				auth: args.subscription.keys.auth,
				updatedAt: now,
			}).where(eq(pushDevices.id, existing.id)),
			db.insert(securityAuditEvents).values(
				auditValues(args, "push.register", existing.id, now),
			),
		]);
		return {
			status: "updated",
			device: publicDevice({
				id: existing.id,
				name: args.name,
				status: "active",
				createdAt: existing.createdAt,
				lastDeliveredAt: existing.lastDeliveredAt,
			}, [], true),
		};
	}

	const [{ count: activeCount } = { count: 0 }] = await db
		.select({ count: count() })
		.from(pushDevices)
		.where(and(
			eq(pushDevices.userId, args.userId),
			eq(pushDevices.organizationId, args.organizationId),
			eq(pushDevices.status, "active"),
		));
	if (activeCount >= ACTIVE_DEVICE_LIMIT) return { status: "limit" };

	const deviceId = newId("pud");
	await db.batch([
		db.insert(pushDevices).values({
			id: deviceId,
			userId: args.userId,
			organizationId: args.organizationId,
			approvingSessionId: session.id,
			name: args.name,
			endpoint: args.subscription.endpoint,
			endpointHash,
			p256dh: args.subscription.keys.p256dh,
			auth: args.subscription.keys.auth,
			status: "active",
			createdAt: now,
			updatedAt: now,
		}),
		db.insert(securityAuditEvents).values(
			auditValues(args, "push.register", deviceId, now),
		),
	]);
	return {
		status: "created",
		device: publicDevice({
			id: deviceId,
			name: args.name,
			status: "active",
			createdAt: now,
			lastDeliveredAt: null,
		}, [], true),
	};
}

export async function listPushDevices(env: CloudflareEnv, args: {
	userId: string;
	organizationId: string;
	sessionToken: string | undefined;
}) {
	const db = getDb(env);
	const rows = await db
		.select({
			id: pushDevices.id,
			name: pushDevices.name,
			status: pushDevices.status,
			approvingSessionId: pushDevices.approvingSessionId,
			createdAt: pushDevices.createdAt,
			lastDeliveredAt: pushDevices.lastDeliveredAt,
		})
		.from(pushDevices)
		.where(and(
			eq(pushDevices.userId, args.userId),
			eq(pushDevices.organizationId, args.organizationId),
		))
		.orderBy(desc(pushDevices.createdAt));
	const ids = rows.map((row) => row.id);
	const preferences = ids.length === 0 ? [] : await db
		.select({ deviceId: pushDeviceMailboxes.deviceId, mailboxId: pushDeviceMailboxes.mailboxId })
		.from(pushDeviceMailboxes)
		.where(inArray(pushDeviceMailboxes.deviceId, ids));
	const currentSession = await readExactSession(
		env, args.userId, args.organizationId, args.sessionToken, new Date(),
	);
	const accessible = new Set(await listAccessibleMailboxIds(db, args.userId, args.organizationId, "read"));

	return { devices: rows.map((row) => publicDevice(
		row,
		preferences
			.filter((preference) => preference.deviceId === row.id && accessible.has(preference.mailboxId))
			.map((preference) => preference.mailboxId)
			.sort(),
		row.approvingSessionId === currentSession?.id,
	)) };
}

async function findOwnedActiveDevice(env: CloudflareEnv, args: DeviceMutation) {
	const [device] = await getDb(env)
		.select({ id: pushDevices.id })
		.from(pushDevices)
		.where(and(
			eq(pushDevices.id, args.deviceId),
			eq(pushDevices.userId, args.userId),
			eq(pushDevices.organizationId, args.organizationId),
			eq(pushDevices.status, "active"),
		))
		.limit(1);
	return device ?? null;
}

export async function renamePushDevice(env: CloudflareEnv, args: DeviceMutation & { name: string }) {
	if (!await findOwnedActiveDevice(env, args)) return { status: "not-found" as const };
	const now = args.now ?? new Date();
	const db = getDb(env);
	await db.batch([
		db.update(pushDevices).set({ name: args.name, updatedAt: now }).where(and(
			eq(pushDevices.id, args.deviceId),
			eq(pushDevices.userId, args.userId),
			eq(pushDevices.organizationId, args.organizationId),
			eq(pushDevices.status, "active"),
		)),
		db.insert(securityAuditEvents).values(auditValues(args, "push.rename", args.deviceId, now)),
	]);
	return { status: "updated" as const };
}

export async function replacePushDevicePreferences(
	env: CloudflareEnv,
	args: DeviceMutation & { mailboxIds: string[] },
) {
	if (!await findOwnedActiveDevice(env, args)) return { status: "not-found" as const };
	const db = getDb(env);
	const accessible = new Set(await listAccessibleMailboxIds(db, args.userId, args.organizationId, "read"));
	if (args.mailboxIds.some((id) => !accessible.has(id))) return { status: "forbidden-mailbox" as const };
	const mailboxIds = [...args.mailboxIds].sort();
	const now = args.now ?? new Date();
	const remove = db.delete(pushDeviceMailboxes).where(eq(pushDeviceMailboxes.deviceId, args.deviceId));
	const audit = db.insert(securityAuditEvents).values(
		auditValues(args, "push.preferences", args.deviceId, now),
	);
	if (mailboxIds.length === 0) {
		await db.batch([remove, audit]);
	} else {
		await db.batch([
			remove,
			db.insert(pushDeviceMailboxes).values(mailboxIds.map((mailboxId) => ({
				deviceId: args.deviceId,
				mailboxId,
				createdAt: now,
			}))),
			audit,
		]);
	}
	return { status: "updated" as const, mailboxIds };
}

export async function revokePushDevice(
	env: CloudflareEnv,
	args: DeviceMutation & { sessionToken: string | undefined },
) {
	const now = args.now ?? new Date();
	const session = await readRecentlyAuthenticatedSession(
		env, args.userId, args.sessionToken, now,
	);
	if (!session || session.organizationId !== args.organizationId) {
		return { status: "recent-auth-required" as const };
	}
	if (!await findOwnedActiveDevice(env, args)) return { status: "not-found" as const };
	const db = getDb(env);
	await db.batch([
		db.update(pushDevices).set({
			status: "revoked",
			revokedAt: now,
			updatedAt: now,
		}).where(and(
			eq(pushDevices.id, args.deviceId),
			eq(pushDevices.userId, args.userId),
			eq(pushDevices.organizationId, args.organizationId),
			eq(pushDevices.status, "active"),
		)),
		db.delete(pushDeviceMailboxes).where(eq(pushDeviceMailboxes.deviceId, args.deviceId)),
		db.update(pushDeliveries).set({
			status: "skipped",
			providerOutcome: "device_revoked",
			terminalAt: now,
		}).where(and(
			eq(pushDeliveries.deviceId, args.deviceId),
			inArray(pushDeliveries.status, ["pending", "delivering"]),
		)),
		db.insert(securityAuditEvents).values(auditValues(args, "push.revoke", args.deviceId, now)),
	]);
	return { status: "revoked" as const };
}
