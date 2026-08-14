import { and, eq, inArray, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { pushDeliveries, pushDevices, pushNotificationEvents } from "@/db/schema";

const CLEANUP_LIMIT = 100;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEVICE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export async function purgePushNotificationState(env: CloudflareEnv, now = new Date()) {
	const db = getDb(env);
	const terminalCutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS);
	const deviceCutoff = new Date(now.getTime() - DEVICE_RETENTION_MS);
	const deliveries = await db
		.select({ id: pushDeliveries.id })
		.from(pushDeliveries)
		.where(and(
			inArray(pushDeliveries.status, ["delivered", "skipped", "failed"]),
			lt(pushDeliveries.terminalAt, terminalCutoff),
		))
		.limit(CLEANUP_LIMIT);
	const events = await db
		.select({ id: pushNotificationEvents.id })
		.from(pushNotificationEvents)
		.where(and(
			inArray(pushNotificationEvents.status, ["complete", "failed"]),
			lt(pushNotificationEvents.completedAt, terminalCutoff),
		))
		.limit(CLEANUP_LIMIT);
	const devices = await db
		.select({ id: pushDevices.id })
		.from(pushDevices)
		.where(or(
			and(eq(pushDevices.status, "revoked"), lt(pushDevices.revokedAt, deviceCutoff)),
			and(eq(pushDevices.status, "expired"), lt(pushDevices.expiredAt, deviceCutoff)),
		))
		.limit(CLEANUP_LIMIT);

	if (deliveries.length > 0) {
		await db.delete(pushDeliveries).where(inArray(pushDeliveries.id, deliveries.map((row) => row.id)));
	}
	if (events.length > 0) {
		await db.delete(pushNotificationEvents).where(inArray(pushNotificationEvents.id, events.map((row) => row.id)));
	}
	if (devices.length > 0) {
		await db.delete(pushDevices).where(inArray(pushDevices.id, devices.map((row) => row.id)));
	}
	return { deliveries: deliveries.length, events: events.length, devices: devices.length };
}
