import { and, desc, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { operationalEvidence } from "@/db/schema";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { newId } from "@/lib/ids";

export const OPERATIONAL_EVIDENCE_CATEGORIES = ["recovery", "release", "smoke", "mail_flow"] as const;
export type OperationalEvidenceCategory = typeof OPERATIONAL_EVIDENCE_CATEGORIES[number];
export type OperationalEvidenceOutcome = "passed" | "failed";
export type OperationalEvidenceStatus = "healthy" | "attention" | "unavailable" | "unknown";

type EvidenceRow = {
	id: string;
	organizationId: string;
	actorUserId: string;
	category: OperationalEvidenceCategory;
	outcome: OperationalEvidenceOutcome;
	passedChecks: number;
	totalChecks: number;
	observedAt: Date;
	recordedAt: Date;
};

export type OperationalEvidenceRecord = {
	category: OperationalEvidenceCategory;
	outcome: OperationalEvidenceOutcome;
	passedChecks: number;
	totalChecks: number;
	observedAt: string;
	recordedAt: string;
};

export type OperationalEvidenceSummary = {
	status: OperationalEvidenceStatus;
	records: OperationalEvidenceRecord[];
};

type RecordEvidenceArgs = {
	organizationId: string;
	actorUserId: string;
	currentToken: string | undefined;
	category: OperationalEvidenceCategory;
	outcome: OperationalEvidenceOutcome;
	passedChecks: number;
	totalChecks: number;
	observedAt: Date;
	now?: Date;
};

export type RecordEvidenceResult =
	| { status: "recent-auth-required" | "invalid" | "conflict" | "duplicate" | "recorded" };

const MAX_EVIDENCE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function normalizeTimestamp(value: Date): Date {
	return new Date(Math.floor(value.getTime() / 1000) * 1000);
}

function validResult(args: RecordEvidenceArgs, now: Date): boolean {
	const observed = args.observedAt.getTime();
	return Number.isFinite(observed) && observed <= now.getTime() && observed >= now.getTime() - MAX_EVIDENCE_AGE_MS &&
		Number.isInteger(args.passedChecks) && Number.isInteger(args.totalChecks) &&
		args.passedChecks >= 0 && args.totalChecks >= 1 && args.totalChecks <= 1000 &&
		args.passedChecks <= args.totalChecks &&
		((args.outcome === "passed" && args.passedChecks === args.totalChecks) ||
			(args.outcome === "failed" && args.passedChecks < args.totalChecks));
}

function sameEvidence(row: EvidenceRow, args: RecordEvidenceArgs): boolean {
	return row.outcome === args.outcome && row.passedChecks === args.passedChecks && row.totalChecks === args.totalChecks;
}

export function buildOperationalEvidenceSummary(
	organizationId: string,
	rows: readonly EvidenceRow[],
): Readonly<OperationalEvidenceSummary> {
	const latest = new Map<OperationalEvidenceCategory, EvidenceRow>();
	for (const row of rows) {
		if (row.organizationId !== organizationId) continue;
		const current = latest.get(row.category);
		if (!current || row.observedAt > current.observedAt ||
			(row.observedAt.getTime() === current.observedAt.getTime() && row.recordedAt > current.recordedAt)) {
			latest.set(row.category, row);
		}
	}
	const records = OPERATIONAL_EVIDENCE_CATEGORIES.flatMap((category) => {
		const row = latest.get(category);
		return row ? [{
			category: row.category,
			outcome: row.outcome,
			passedChecks: row.passedChecks,
			totalChecks: row.totalChecks,
			observedAt: row.observedAt.toISOString(),
			recordedAt: row.recordedAt.toISOString(),
		}] : [];
	});
	const status: OperationalEvidenceStatus = records.some((record) => record.outcome === "failed")
		? "attention"
		: records.length === OPERATIONAL_EVIDENCE_CATEGORIES.length ? "healthy" : "unknown";
	for (const record of records) Object.freeze(record);
	return Object.freeze({ status, records: Object.freeze(records) as OperationalEvidenceRecord[] });
}

export async function readOperationalEvidenceFromDb(
	db: AppDatabase,
	organizationId: string,
): Promise<Readonly<OperationalEvidenceSummary>> {
	const rows = await db.select({
		id: operationalEvidence.id,
		organizationId: operationalEvidence.organizationId,
		actorUserId: operationalEvidence.actorUserId,
		category: operationalEvidence.category,
		outcome: operationalEvidence.outcome,
		passedChecks: operationalEvidence.passedChecks,
		totalChecks: operationalEvidence.totalChecks,
		observedAt: operationalEvidence.observedAt,
		recordedAt: operationalEvidence.recordedAt,
	}).from(operationalEvidence)
		.where(eq(operationalEvidence.organizationId, organizationId))
		.orderBy(desc(operationalEvidence.observedAt), desc(operationalEvidence.recordedAt))
		.limit(200);
	return buildOperationalEvidenceSummary(organizationId, rows);
}

export async function readOperationalEvidence(env: CloudflareEnv, organizationId: string) {
	return readOperationalEvidenceFromDb(getDb(env), organizationId);
}

export async function recordOperationalEvidence(
	env: CloudflareEnv,
	args: RecordEvidenceArgs,
): Promise<RecordEvidenceResult> {
	const now = args.now ?? new Date();
	const current = await readRecentlyAuthenticatedSession(env, args.actorUserId, args.currentToken, now);
	if (current?.organizationId !== args.organizationId) return { status: "recent-auth-required" };
	if (!validResult(args, now)) return { status: "invalid" };

	const observedAt = normalizeTimestamp(args.observedAt);
	const db = getDb(env);
	const [existing] = await db.select().from(operationalEvidence).where(and(
		eq(operationalEvidence.organizationId, args.organizationId),
		eq(operationalEvidence.category, args.category),
		eq(operationalEvidence.observedAt, observedAt),
	)).limit(1);
	if (existing) return { status: sameEvidence(existing, args) ? "duplicate" : "conflict" };

	const id = newId("ope");
	const inserted = await db.insert(operationalEvidence).values({
		id,
		organizationId: args.organizationId,
		actorUserId: args.actorUserId,
		category: args.category,
		outcome: args.outcome,
		passedChecks: args.passedChecks,
		totalChecks: args.totalChecks,
		observedAt,
		recordedAt: now,
	}).onConflictDoNothing().returning({ id: operationalEvidence.id });
	if (inserted.length === 1) return { status: "recorded" };

	// A concurrent request may have won the unique organization/category/time key
	// after the first read. Re-read inside the same tenant boundary so an exact
	// replay remains idempotent while a different result can never replace history.
	const [winner] = await db.select().from(operationalEvidence).where(and(
		eq(operationalEvidence.organizationId, args.organizationId),
		eq(operationalEvidence.category, args.category),
		eq(operationalEvidence.observedAt, observedAt),
	)).limit(1);
	return { status: winner && sameEvidence(winner, args) ? "duplicate" : "conflict" };
}
