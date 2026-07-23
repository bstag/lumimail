import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { imapUidCounter, messages } from "@/db/schema";

const COUNTER_ID = 1;
const MAX_IMAP_UID = 2_147_483_647;

export async function reserveImapUid(db: AppDatabase): Promise<number> {
	const [counter] = await db
		.update(imapUidCounter)
		.set({ value: sql`${imapUidCounter.value} + 1` })
		.where(and(eq(imapUidCounter.id, COUNTER_ID), sql`${imapUidCounter.value} < ${MAX_IMAP_UID}`))
		.returning({ value: imapUidCounter.value });
	if (!counter || counter.value < 1 || counter.value > MAX_IMAP_UID) {
		throw new Error("IMAP UID space exhausted");
	}
	return counter.value;
}

export async function allocateImapUid(db: AppDatabase, messageId: string): Promise<number> {
	const [existing] = await db
		.select({ imapUid: messages.imapUid })
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);
	if (existing?.imapUid) return existing.imapUid;

	const reserved = await reserveImapUid(db);
	const [updated] = await db
		.update(messages)
		.set({ imapUid: reserved })
		.where(and(eq(messages.id, messageId), isNull(messages.imapUid)))
		.returning({ imapUid: messages.imapUid });
	if (updated?.imapUid) return updated.imapUid;

	const [winner] = await db
		.select({ imapUid: messages.imapUid })
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);
	if (!winner?.imapUid) throw new Error("Unable to allocate IMAP UID");
	return winner.imapUid;
}
