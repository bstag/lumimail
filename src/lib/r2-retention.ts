import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { attachments, messageBodies } from "@/db/schema";

/**
 * Objects are only ever considered under prefixes Lumimail owns, so unrelated
 * future use of the bucket cannot be destroyed by a sweep.
 */
export const RAW_PREFIX = "inbound/";
export const ATTACHMENT_PREFIX = "attachments/";

/** Days an unreferenced object is kept before it becomes eligible for deletion. */
export const RETENTION_DAYS = 7;

const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_OBJECTS = 1000;
const LIST_PAGE_SIZE = 500;
const SAMPLE_SIZE = 20;

/**
 * The sweep shares the one-minute queue-health cron, but retention is measured in
 * days, so running a full bucket listing every tick is pure waste. Restrict it to
 * the top of each hour.
 */
export function shouldRunSweep(scheduledTime: number): boolean {
	return new Date(scheduledTime).getUTCMinutes() === 0;
}

export type R2OrphanCandidate = { key: string; size: number; uploaded: Date };

export type RetentionReport = {
	scanned: number;
	orphans: number;
	bytes: number;
	oldestUploadedAt: string | null;
	sample: string[];
};

type SweepOptions = { now?: Date; maxObjects?: number };

type R2ListedObject = { key: string; size: number; uploaded: Date };

async function listPrefix(
	env: CloudflareEnv,
	prefix: string,
	budget: number,
): Promise<R2ListedObject[]> {
	const collected: R2ListedObject[] = [];
	let cursor: string | undefined;

	while (collected.length < budget) {
		const page = await env.BUCKET.list({
			prefix,
			cursor,
			limit: Math.min(LIST_PAGE_SIZE, budget - collected.length),
		});
		collected.push(...(page.objects as unknown as R2ListedObject[]));
		if (!page.truncated) break;
		cursor = (page as { cursor?: string }).cursor;
	}

	return collected.slice(0, budget);
}

/**
 * Returns the keys under a prefix that no D1 row still references.
 *
 * Referencedness is read from the columns that own the keys rather than from a
 * separate ledger, so there is no bookkeeping that can drift out of step with
 * what R2 actually holds.
 */
async function selectUnreferenced(
	db: ReturnType<typeof getDb>,
	prefix: string,
	candidates: R2ListedObject[],
): Promise<R2ListedObject[]> {
	if (candidates.length === 0) return [];

	const keys = candidates.map((candidate) => candidate.key);
	const referenced = new Set<string>();

	if (prefix === RAW_PREFIX) {
		const rows = await db
			.select({ rawR2Key: messageBodies.rawR2Key })
			.from(messageBodies)
			.where(inArray(messageBodies.rawR2Key, keys));
		for (const row of rows) {
			if (row.rawR2Key) referenced.add(row.rawR2Key);
		}
	} else {
		const rows = await db
			.select({ r2Key: attachments.r2Key })
			.from(attachments)
			.where(inArray(attachments.r2Key, keys));
		for (const row of rows) referenced.add(row.r2Key);
	}

	return candidates.filter((candidate) => !referenced.has(candidate.key));
}

/**
 * Finds objects eligible for deletion: unreferenced in D1 *and* older than the
 * retention age. The age bound is what makes the unreferenced check safe — an
 * object written moments ago may not have had its D1 row committed yet, so age
 * alone protects every in-flight write.
 */
export async function findR2Orphans(
	env: CloudflareEnv,
	options: SweepOptions = {},
): Promise<{ scanned: number; orphans: R2OrphanCandidate[] }> {
	const now = options.now ?? new Date();
	const cutoff = new Date(now.getTime() - RETENTION_MS);
	const maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS;
	const db = getDb(env);

	let scanned = 0;
	const orphans: R2OrphanCandidate[] = [];

	for (const prefix of [RAW_PREFIX, ATTACHMENT_PREFIX]) {
		const budget = maxObjects - scanned;
		if (budget <= 0) break;

		const listed = await listPrefix(env, prefix, budget);
		scanned += listed.length;

		const aged = listed.filter((object) => object.uploaded.getTime() <= cutoff.getTime());
		orphans.push(...(await selectUnreferenced(db, prefix, aged)));
	}

	return { scanned, orphans };
}

export async function reportR2Retention(
	env: CloudflareEnv,
	options: SweepOptions = {},
): Promise<RetentionReport> {
	const { scanned, orphans } = await findR2Orphans(env, options);
	const oldest = orphans.reduce<Date | null>(
		(earliest, orphan) =>
			!earliest || orphan.uploaded.getTime() < earliest.getTime() ? orphan.uploaded : earliest,
		null,
	);

	return {
		scanned,
		orphans: orphans.length,
		bytes: orphans.reduce((total, orphan) => total + orphan.size, 0),
		oldestUploadedAt: oldest ? oldest.toISOString() : null,
		sample: orphans.slice(0, SAMPLE_SIZE).map((orphan) => orphan.key),
	};
}

export async function deleteR2Orphans(
	env: CloudflareEnv,
	options: SweepOptions & { limit?: number } = {},
): Promise<{ deleted: number; bytes: number; remaining: number }> {
	const { orphans } = await findR2Orphans(env, options);
	const limit = options.limit ?? orphans.length;
	const targets = orphans.slice(0, limit);

	let deleted = 0;
	let bytes = 0;
	for (const target of targets) {
		try {
			await env.BUCKET.delete(target.key);
			deleted += 1;
			bytes += target.size;
		} catch {
			// Leave it for the next run rather than failing the whole sweep.
		}
	}

	return { deleted, bytes, remaining: orphans.length - deleted };
}
