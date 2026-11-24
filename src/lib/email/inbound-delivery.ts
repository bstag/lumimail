import { and, eq, lt } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { inboundDeliveries } from "@/db/schema";

type Delivery = typeof inboundDeliveries.$inferSelect;
type DeliveryKey = Pick<Delivery, "rawR2Key" | "mailboxId">;

function deliveryKey({ rawR2Key, mailboxId }: DeliveryKey) {
	return and(eq(inboundDeliveries.rawR2Key, rawR2Key), eq(inboundDeliveries.mailboxId, mailboxId));
}

export async function readInboundDelivery(db: AppDatabase, key: DeliveryKey) {
	const [delivery] = await db.select().from(inboundDeliveries).where(deliveryKey(key)).limit(1);
	return delivery;
}

export async function advanceInboundDelivery(db: AppDatabase, key: DeliveryKey, from: Delivery["stage"], to: Delivery["stage"]) {
	const changed = await db.update(inboundDeliveries).set({ stage: to })
		.where(and(deliveryKey(key), eq(inboundDeliveries.stage, from)))
		.returning({ mailboxId: inboundDeliveries.mailboxId });
	return changed.length > 0;
}

export async function purgeInboundDeliveries(env: CloudflareEnv, now = new Date()): Promise<void> {
	const cutoff = new Date(now.getTime() - 30 * 86_400_000);
	await getDb(env).delete(inboundDeliveries)
		.where(and(eq(inboundDeliveries.stage, "complete"), lt(inboundDeliveries.createdAt, cutoff)));
}
