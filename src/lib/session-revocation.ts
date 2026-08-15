import { and, eq, gt, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { securityAuditEvents, sessions } from "@/db/schema";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { newId } from "@/lib/ids";

type RevocationArgs = {
	organizationId: string;
	actorUserId: string;
	currentToken: string | undefined;
	requestId: string;
	now?: Date;
};

type TargetRevocationArgs = RevocationArgs & { targetSessionId: string };

export type SessionRevocationResult =
	| { status: "recent-auth-required" }
	| { status: "not-found" }
	| { status: "current-session" }
	| { status: "revoked"; revokedCount: number; requestId: string };

export type OtherSessionRevocationResult =
	| { status: "recent-auth-required" }
	| { status: "revoked"; revokedCount: number; requestId: string };

async function currentSessionForOrganization(env: CloudflareEnv, args: RevocationArgs) {
	const current = await readRecentlyAuthenticatedSession(
		env, args.actorUserId, args.currentToken, args.now,
	);
	return current?.organizationId === args.organizationId ? current : null;
}

function auditValues(
	args: RevocationArgs,
	action: "session.revoke" | "session.revoke_others",
	resourceId: string | null,
	affectedCount: number,
	now: Date,
) {
	return {
		id: newId("aud"),
		organizationId: args.organizationId,
		actorUserId: args.actorUserId,
		action,
		resourceType: "session" as const,
		resourceId,
		affectedCount,
		requestId: args.requestId,
		outcome: "succeeded" as const,
		createdAt: now,
	};
}

export async function revokeOrganizationSession(
	env: CloudflareEnv,
	args: TargetRevocationArgs,
): Promise<SessionRevocationResult> {
	const now = args.now ?? new Date();
	const current = await currentSessionForOrganization(env, { ...args, now });
	if (!current) return { status: "recent-auth-required" };
	if (args.targetSessionId === current.id) return { status: "current-session" };

	const db = getDb(env);
	const [target] = await db
		.select({ id: sessions.id })
		.from(sessions)
		.where(and(
			eq(sessions.id, args.targetSessionId),
			eq(sessions.organizationId, args.organizationId),
			gt(sessions.expiresAt, now),
		))
		.limit(1);
	if (!target) return { status: "not-found" };

	await db.batch([
		db.delete(sessions).where(and(
			eq(sessions.id, args.targetSessionId),
			eq(sessions.organizationId, args.organizationId),
			gt(sessions.expiresAt, now),
		)),
		db.insert(securityAuditEvents).values(
			auditValues(args, "session.revoke", args.targetSessionId, 1, now),
		),
	]);
	return { status: "revoked", revokedCount: 1, requestId: args.requestId };
}

export async function revokeOtherOrganizationSessions(
	env: CloudflareEnv,
	args: RevocationArgs,
): Promise<OtherSessionRevocationResult> {
	const now = args.now ?? new Date();
	const current = await currentSessionForOrganization(env, { ...args, now });
	if (!current) return { status: "recent-auth-required" };

	const db = getDb(env);
	const targets = await db
		.select({ id: sessions.id })
		.from(sessions)
		.where(and(
			eq(sessions.organizationId, args.organizationId),
			gt(sessions.expiresAt, now),
			ne(sessions.id, current.id),
		));

	await db.batch([
		db.delete(sessions).where(and(
			eq(sessions.organizationId, args.organizationId),
			gt(sessions.expiresAt, now),
			ne(sessions.id, current.id),
		)),
		db.insert(securityAuditEvents).values(
			auditValues(args, "session.revoke_others", null, targets.length, now),
		),
	]);
	return { status: "revoked", revokedCount: targets.length, requestId: args.requestId };
}
