import {
	and,
	eq,
	gt,
	inArray,
	isNull,
	lt,
	or,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
	mailboxMemberships,
	messages,
	pushDeliveries,
	pushDeviceMailboxes,
	pushDevices,
	pushNotificationEvents,
	sessions,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { sendPrivatePush } from "@/lib/push/provider";
import type { PushQueueMessage } from "../../../worker-utils";

const EXPANSION_PAGE_SIZE = 50;
const RECONCILIATION_LIMIT = 100;
const LEASE_MS = 30_000;
const RETRY_DELAYS_SECONDS = [60, 300] as const;
const MAX_PROVIDER_ATTEMPTS = 3;
const READ_ROLES = ["viewer", "responder", "manager"] as const;

export type PushQueueResult =
	| { action: "ack" }
	| { action: "retry"; delaySeconds: number };

function isUnreadInboxMessage(row: {
	direction: string;
	messageStatus: string;
	read: boolean;
}) {
	return row.direction === "inbound" && row.messageStatus === "received" && !row.read;
}

async function expandPushEvent(
	env: CloudflareEnv,
	eventId: string,
	now: Date,
): Promise<PushQueueResult> {
	const db = getDb(env);
	const leaseUntil = new Date(now.getTime() + LEASE_MS);
	const claimed = await db
		.update(pushNotificationEvents)
		.set({ status: "expanding", leaseUntil })
		.where(and(
			eq(pushNotificationEvents.id, eventId),
			inArray(pushNotificationEvents.status, ["pending", "expanding"]),
			or(isNull(pushNotificationEvents.leaseUntil), lt(pushNotificationEvents.leaseUntil, now)),
		))
		.returning({ id: pushNotificationEvents.id });
	if (claimed.length !== 1) return { action: "ack" };

	const [event] = await db
		.select({
			id: pushNotificationEvents.id,
			organizationId: pushNotificationEvents.organizationId,
			mailboxId: pushNotificationEvents.mailboxId,
			messageId: pushNotificationEvents.messageId,
			status: pushNotificationEvents.status,
			expansionCursor: pushNotificationEvents.expansionCursor,
			direction: messages.direction,
			messageStatus: messages.status,
			read: messages.read,
		})
		.from(pushNotificationEvents)
		.innerJoin(messages, eq(messages.id, pushNotificationEvents.messageId))
		.where(eq(pushNotificationEvents.id, eventId))
		.limit(1);
	if (!event || !isUnreadInboxMessage(event)) {
		await db.update(pushNotificationEvents).set({
			status: "complete", leaseUntil: null, completedAt: now,
		}).where(eq(pushNotificationEvents.id, eventId));
		return { action: "ack" };
	}

	const eligibleDevices = await db
		.select({ id: pushDevices.id })
		.from(pushDevices)
		.innerJoin(pushDeviceMailboxes, and(
			eq(pushDeviceMailboxes.deviceId, pushDevices.id),
			eq(pushDeviceMailboxes.mailboxId, event.mailboxId),
		))
		.innerJoin(sessions, and(
			eq(sessions.id, pushDevices.approvingSessionId),
			eq(sessions.userId, pushDevices.userId),
			eq(sessions.organizationId, pushDevices.organizationId),
		))
		.innerJoin(mailboxMemberships, and(
			eq(mailboxMemberships.mailboxId, event.mailboxId),
			eq(mailboxMemberships.userId, pushDevices.userId),
		))
		.where(and(
			eq(pushDevices.organizationId, event.organizationId),
			eq(pushDevices.status, "active"),
			gt(sessions.expiresAt, now),
			inArray(mailboxMemberships.role, [...READ_ROLES]),
			event.expansionCursor ? gt(pushDevices.id, event.expansionCursor) : undefined,
		))
		.orderBy(pushDevices.id)
		.limit(EXPANSION_PAGE_SIZE);

	const deviceIds = eligibleDevices.map((device) => device.id);
	const existing = deviceIds.length === 0 ? [] : await db
		.select({ id: pushDeliveries.id, deviceId: pushDeliveries.deviceId })
		.from(pushDeliveries)
		.where(and(
			eq(pushDeliveries.eventId, event.id),
			inArray(pushDeliveries.deviceId, deviceIds),
		));
	const deliveryByDevice = new Map(existing.map((row) => [row.deviceId, row.id]));

	for (const device of eligibleDevices) {
		let deliveryId = deliveryByDevice.get(device.id);
		if (!deliveryId) {
			deliveryId = newId("pudl");
			await db.insert(pushDeliveries).values({
				id: deliveryId,
				eventId: event.id,
				deviceId: device.id,
				status: "pending",
				attempts: 0,
				nextAttemptAt: now,
				createdAt: now,
			}).onConflictDoNothing();
		}
		try {
			await env.PUSH_QUEUE.send({ kind: "push-deliver", version: 1, deliveryId });
		} catch {
			// The pending D1 delivery remains available to scheduled reconciliation.
		}
	}

	const hasNextPage = eligibleDevices.length === EXPANSION_PAGE_SIZE;
	const cursor = eligibleDevices.at(-1)?.id ?? event.expansionCursor;
	await db.update(pushNotificationEvents).set(hasNextPage ? {
		status: "pending",
		expansionCursor: cursor,
		leaseUntil: null,
		nextAttemptAt: now,
	} : {
		status: "complete",
		expansionCursor: cursor,
		leaseUntil: null,
		completedAt: now,
	}).where(eq(pushNotificationEvents.id, event.id));
	if (hasNextPage) {
		try {
			await env.PUSH_QUEUE.send({ kind: "push-expand", version: 1, eventId: event.id });
		} catch {
			// Scheduled reconciliation will wake the pending page.
		}
	}
	return { action: "ack" };
}

type EligibilityProjection = {
	deliveryId: string;
	eventId: string;
	deviceId: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	deviceStatus: string;
	deviceUserId: string;
	deviceOrganizationId: string;
	approvingSessionId: string;
	sessionUserId: string;
	sessionOrganizationId: string | null;
	sessionExpiresAt: Date;
	preferenceDeviceId: string;
	preferenceMailboxId: string;
	membershipUserId: string;
	membershipMailboxId: string;
	membershipRole: string;
	eventOrganizationId: string;
	eventMailboxId: string;
	eventMessageId: string;
	messageOrganizationId: string | null;
	messageMailboxId: string | null;
	direction: string;
	messageStatus: string;
	read: boolean;
};

function isEligibleDelivery(row: EligibilityProjection, now: Date): boolean {
	return row.deviceStatus === "active"
		&& row.deviceUserId === row.sessionUserId
		&& row.deviceOrganizationId === row.sessionOrganizationId
		&& row.deviceOrganizationId === row.eventOrganizationId
		&& row.deviceOrganizationId === row.messageOrganizationId
		&& row.approvingSessionId.length > 0
		&& row.sessionExpiresAt.getTime() > now.getTime()
		&& row.preferenceDeviceId === row.deviceId
		&& row.preferenceMailboxId === row.eventMailboxId
		&& row.membershipUserId === row.deviceUserId
		&& row.membershipMailboxId === row.eventMailboxId
		&& READ_ROLES.includes(row.membershipRole as typeof READ_ROLES[number])
		&& row.eventMailboxId === row.messageMailboxId
		&& row.eventMessageId.length > 0
		&& isUnreadInboxMessage(row);
}

async function terminalizeDelivery(
	env: CloudflareEnv,
	deliveryId: string,
	values: { status: "skipped" | "failed"; providerOutcome: string; terminalAt: Date; attempts?: number },
) {
	await getDb(env).update(pushDeliveries).set({
		...values,
		leaseUntil: null,
	}).where(eq(pushDeliveries.id, deliveryId));
}

async function deliverPrivatePush(
	env: CloudflareEnv,
	deliveryId: string,
	now: Date,
): Promise<PushQueueResult> {
	const db = getDb(env);
	const [delivery] = await db
		.select({
			id: pushDeliveries.id,
			eventId: pushDeliveries.eventId,
			deviceId: pushDeliveries.deviceId,
			status: pushDeliveries.status,
			attempts: pushDeliveries.attempts,
			nextAttemptAt: pushDeliveries.nextAttemptAt,
		})
		.from(pushDeliveries)
		.where(eq(pushDeliveries.id, deliveryId))
		.limit(1);
	if (!delivery || delivery.status !== "pending" || delivery.nextAttemptAt.getTime() > now.getTime()) {
		return { action: "ack" };
	}

	const leaseUntil = new Date(now.getTime() + LEASE_MS);
	const claimed = await db.update(pushDeliveries).set({
		status: "delivering", leaseUntil,
	}).where(and(
		eq(pushDeliveries.id, deliveryId),
		eq(pushDeliveries.status, "pending"),
		or(isNull(pushDeliveries.leaseUntil), lt(pushDeliveries.leaseUntil, now)),
	)).returning({ id: pushDeliveries.id });
	if (claimed.length !== 1) return { action: "ack" };

	const [row] = await db
		.select({
			deliveryId: pushDeliveries.id,
			eventId: pushNotificationEvents.id,
			deviceId: pushDevices.id,
			endpoint: pushDevices.endpoint,
			p256dh: pushDevices.p256dh,
			auth: pushDevices.auth,
			deviceStatus: pushDevices.status,
			deviceUserId: pushDevices.userId,
			deviceOrganizationId: pushDevices.organizationId,
			approvingSessionId: pushDevices.approvingSessionId,
			sessionUserId: sessions.userId,
			sessionOrganizationId: sessions.organizationId,
			sessionExpiresAt: sessions.expiresAt,
			preferenceDeviceId: pushDeviceMailboxes.deviceId,
			preferenceMailboxId: pushDeviceMailboxes.mailboxId,
			membershipUserId: mailboxMemberships.userId,
			membershipMailboxId: mailboxMemberships.mailboxId,
			membershipRole: mailboxMemberships.role,
			eventOrganizationId: pushNotificationEvents.organizationId,
			eventMailboxId: pushNotificationEvents.mailboxId,
			eventMessageId: pushNotificationEvents.messageId,
			messageOrganizationId: messages.organizationId,
			messageMailboxId: messages.mailboxId,
			direction: messages.direction,
			messageStatus: messages.status,
			read: messages.read,
		})
		.from(pushDeliveries)
		.innerJoin(pushNotificationEvents, eq(pushNotificationEvents.id, pushDeliveries.eventId))
		.innerJoin(pushDevices, eq(pushDevices.id, pushDeliveries.deviceId))
		.innerJoin(sessions, eq(sessions.id, pushDevices.approvingSessionId))
		.innerJoin(pushDeviceMailboxes, and(
			eq(pushDeviceMailboxes.deviceId, pushDevices.id),
			eq(pushDeviceMailboxes.mailboxId, pushNotificationEvents.mailboxId),
		))
		.innerJoin(mailboxMemberships, and(
			eq(mailboxMemberships.userId, pushDevices.userId),
			eq(mailboxMemberships.mailboxId, pushNotificationEvents.mailboxId),
		))
		.innerJoin(messages, eq(messages.id, pushNotificationEvents.messageId))
		.where(eq(pushDeliveries.id, deliveryId))
		.limit(1);
	if (!row || !isEligibleDelivery(row, now)) {
		await terminalizeDelivery(env, deliveryId, {
			status: "skipped", providerOutcome: "authorization_revoked", terminalAt: now,
		});
		return { action: "ack" };
	}

	const result = await sendPrivatePush(env as CloudflareEnv & {
		VAPID_PUBLIC_KEY?: string;
		VAPID_PRIVATE_KEY?: string;
		VAPID_SUBJECT?: string;
	}, {
		endpoint: row.endpoint,
		p256dh: row.p256dh,
		auth: row.auth,
	}, { deliveryId: row.deliveryId, topic: row.eventId });
	const attempts = delivery.attempts + 1;
	if (result.outcome === "delivered") {
		await db.batch([
			db.update(pushDeliveries).set({
				status: "delivered", attempts, leaseUntil: null,
				providerOutcome: "accepted", deliveredAt: now, terminalAt: now,
			}).where(eq(pushDeliveries.id, deliveryId)),
			db.update(pushDevices).set({ lastDeliveredAt: now, updatedAt: now })
				.where(eq(pushDevices.id, row.deviceId)),
		]);
		return { action: "ack" };
	}
	if (result.outcome === "expired") {
		await db.batch([
			db.update(pushDeliveries).set({
				status: "failed", attempts, leaseUntil: null,
				providerOutcome: "subscription_expired", terminalAt: now,
			}).where(eq(pushDeliveries.id, deliveryId)),
			db.update(pushDevices).set({ status: "expired", expiredAt: now, updatedAt: now })
				.where(eq(pushDevices.id, row.deviceId)),
			db.delete(pushDeviceMailboxes).where(eq(pushDeviceMailboxes.deviceId, row.deviceId)),
		]);
		return { action: "ack" };
	}
	if (result.outcome === "failed") {
		await terminalizeDelivery(env, deliveryId, {
			status: "failed", attempts, providerOutcome: "provider_rejected", terminalAt: now,
		});
		return { action: "ack" };
	}
	if (attempts >= MAX_PROVIDER_ATTEMPTS) {
		await terminalizeDelivery(env, deliveryId, {
			status: "failed", attempts, providerOutcome: "retry_exhausted", terminalAt: now,
		});
		return { action: "ack" };
	}
	const delaySeconds = attempts === 1 ? RETRY_DELAYS_SECONDS[0] : RETRY_DELAYS_SECONDS[1];
	await db.update(pushDeliveries).set({
		status: "pending",
		attempts,
		leaseUntil: null,
		providerOutcome: result.reason,
		nextAttemptAt: new Date(now.getTime() + delaySeconds * 1_000),
	}).where(eq(pushDeliveries.id, deliveryId));
	return { action: "retry", delaySeconds };
}

export async function processPushQueueMessage(
	env: CloudflareEnv,
	message: PushQueueMessage,
	now = new Date(),
): Promise<PushQueueResult> {
	return message.kind === "push-expand"
		? expandPushEvent(env, message.eventId, now)
		: deliverPrivatePush(env, message.deliveryId, now);
}

export async function reconcilePushNotifications(env: CloudflareEnv, now = new Date()) {
	const db = getDb(env);
	const events = await db
		.select({ id: pushNotificationEvents.id })
		.from(pushNotificationEvents)
		.where(and(
			inArray(pushNotificationEvents.status, ["pending", "expanding"]),
			or(isNull(pushNotificationEvents.leaseUntil), lt(pushNotificationEvents.leaseUntil, now)),
			lt(pushNotificationEvents.nextAttemptAt, new Date(now.getTime() + 1)),
		))
		.limit(RECONCILIATION_LIMIT);
	const deliveryLimit = RECONCILIATION_LIMIT - events.length;
	const deliveries = deliveryLimit === 0 ? [] : await db
		.select({ id: pushDeliveries.id })
		.from(pushDeliveries)
		.where(and(
			inArray(pushDeliveries.status, ["pending", "delivering"]),
			or(isNull(pushDeliveries.leaseUntil), lt(pushDeliveries.leaseUntil, now)),
			lt(pushDeliveries.nextAttemptAt, new Date(now.getTime() + 1)),
		))
		.limit(deliveryLimit);
	for (const event of events) {
		try {
			await env.PUSH_QUEUE.send({ kind: "push-expand", version: 1, eventId: event.id });
		} catch {
			// A future scheduled run will retry the still-due row.
		}
	}
	for (const delivery of deliveries) {
		try {
			await env.PUSH_QUEUE.send({ kind: "push-deliver", version: 1, deliveryId: delivery.id });
		} catch {
			// A future scheduled run will retry the still-due row.
		}
	}
	return { events: events.length, deliveries: deliveries.length };
}
