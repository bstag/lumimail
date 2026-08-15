import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, outboundJobs } from "@/db/schema";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { parseDeliverySnapshot } from "@/lib/email/outbound/snapshot";
import { normalizeReferences, normalizeRfcMessageId } from "@/lib/email/threading";
import { recordOperationalEvidence, type RecordEvidenceResult } from "@/lib/operational-evidence";

const TOTAL_MAIL_FLOW_CHECKS = 8;
const MAX_EVIDENCE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

type InboundTrace = {
	id: string;
	rfcMessageId: string | null;
	threadId: string | null;
};

type OutboundTrace = {
	id: string;
	threadId: string | null;
	replySourceMessageId: string | null;
	inReplyTo: string | null;
	referencesHeader: string | null;
	status: string;
	providerMessageId: string | null;
	rfcMessageId: string | null;
	jobStatus: string | null;
	jobAttempts: number | null;
	jobError: string | null;
	jobPayload: string | null;
};

type MailFlowProof = {
	deliveredMessageId: string;
	deliveredInReplyTo: string;
	deliveredReferences: string;
};

type RecordMailFlowArgs = MailFlowProof & {
	organizationId: string;
	actorUserId: string;
	currentToken: string | undefined;
	observedAt: Date;
	now?: Date;
};

type MailFlowEvidenceResult = RecordEvidenceResult & {
	outcome?: "passed" | "failed";
	passedChecks?: number;
	totalChecks?: number;
};

function canonicalReferences(value: string): string | null {
	const references = normalizeReferences(value);
	if (!references.length) return null;
	const canonical = references.join(" ");
	return canonical === value && new TextEncoder().encode(canonical).byteLength <= 2048 ? canonical : null;
}

function validProof(proof: MailFlowProof, observedAt: Date, now: Date): boolean {
	const deliveredMessageId = normalizeRfcMessageId(proof.deliveredMessageId);
	const deliveredInReplyTo = normalizeRfcMessageId(proof.deliveredInReplyTo);
	const deliveredReferences = canonicalReferences(proof.deliveredReferences);
	const observed = observedAt.getTime();
	return deliveredMessageId === proof.deliveredMessageId &&
		deliveredInReplyTo === proof.deliveredInReplyTo &&
		deliveredReferences !== null && normalizeReferences(deliveredReferences).includes(deliveredInReplyTo) &&
		Number.isFinite(observed) && observed <= now.getTime() && observed >= now.getTime() - MAX_EVIDENCE_AGE_MS;
}

export function deriveMailFlowChecks({
	inbound,
	outbound,
	proof,
}: {
	inbound: InboundTrace | null;
	outbound: OutboundTrace | null;
	proof: MailFlowProof;
}): { passedChecks: number; totalChecks: 8 } {
	const inboundId = inbound?.rfcMessageId ?? null;
	const storedReferences = normalizeReferences(outbound?.referencesHeader);
	const deliveredReferences = normalizeReferences(proof.deliveredReferences);
	const snapshot = outbound?.jobPayload ? parseDeliverySnapshot(outbound.jobPayload) : null;
	const checks = [
		inbound !== null && inboundId === proof.deliveredInReplyTo,
		outbound !== null,
		inbound !== null && outbound !== null && outbound.replySourceMessageId === inbound.id &&
			inbound.threadId !== null && outbound.threadId === inbound.threadId,
		outbound !== null && outbound.inReplyTo === inboundId,
		inboundId !== null && storedReferences.includes(inboundId),
		snapshot?.headers?.["In-Reply-To"] === inboundId &&
			snapshot?.headers?.References === outbound?.referencesHeader,
		outbound?.status === "sent" && outbound.jobStatus === "sent",
		outbound?.providerMessageId === proof.deliveredMessageId &&
			outbound.rfcMessageId === proof.deliveredMessageId &&
			(outbound.jobAttempts ?? 0) >= 1 && outbound.jobError === null &&
			inboundId !== null && deliveredReferences.includes(inboundId),
	];
	return { passedChecks: checks.filter(Boolean).length, totalChecks: TOTAL_MAIL_FLOW_CHECKS };
}

export async function recordMailFlowEvidence(
	env: CloudflareEnv,
	args: RecordMailFlowArgs,
): Promise<MailFlowEvidenceResult> {
	const now = args.now ?? new Date();
	const current = await readRecentlyAuthenticatedSession(env, args.actorUserId, args.currentToken, now);
	if (current?.organizationId !== args.organizationId) return { status: "recent-auth-required" };
	if (!validProof(args, args.observedAt, now)) return { status: "invalid" };

	const db = getDb(env);
	const inboundRows = await db.select({
		id: messages.id,
		rfcMessageId: messages.rfcMessageId,
		threadId: messages.threadId,
	}).from(messages).where(and(
		eq(messages.organizationId, args.organizationId),
		eq(messages.direction, "inbound"),
		eq(messages.rfcMessageId, args.deliveredInReplyTo),
	)).limit(2);
	const inbound = inboundRows.length === 1 ? inboundRows[0] : null;

	let outbound: OutboundTrace | null = null;
	if (inbound) {
		const outboundRows = await db.select({
			id: messages.id,
			threadId: messages.threadId,
			replySourceMessageId: messages.replySourceMessageId,
			inReplyTo: messages.inReplyTo,
			referencesHeader: messages.referencesHeader,
			status: messages.status,
			providerMessageId: messages.providerMessageId,
			rfcMessageId: messages.rfcMessageId,
			jobStatus: outboundJobs.status,
			jobAttempts: outboundJobs.attempts,
			jobError: outboundJobs.error,
			jobPayload: outboundJobs.payload,
		}).from(messages).leftJoin(outboundJobs, eq(outboundJobs.messageId, messages.id)).where(and(
			eq(messages.organizationId, args.organizationId),
			eq(messages.direction, "outbound"),
			eq(messages.replySourceMessageId, inbound.id),
			or(
				eq(messages.rfcMessageId, args.deliveredMessageId),
				eq(messages.providerMessageId, args.deliveredMessageId),
			),
		)).limit(2);
		outbound = outboundRows.length === 1 ? outboundRows[0] as OutboundTrace : null;
	}

	const counts = deriveMailFlowChecks({ inbound, outbound, proof: args });
	const outcome = counts.passedChecks === counts.totalChecks ? "passed" : "failed";
	const recorded = await recordOperationalEvidence(env, {
		organizationId: args.organizationId,
		actorUserId: args.actorUserId,
		currentToken: args.currentToken,
		category: "mail_flow",
		outcome,
		...counts,
		observedAt: args.observedAt,
		now,
	});
	if (recorded.status === "recorded" || recorded.status === "duplicate") {
		return { ...recorded, outcome, ...counts };
	}
	return recorded;
}
