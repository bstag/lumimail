import { and, desc, eq, lt, or } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { securityAuditEvents } from "@/db/schema";

export const SECURITY_EVENT_DEFAULT_LIMIT = 20;
export const SECURITY_EVENT_MAX_LIMIT = 50;

export type SecurityEventCursor = {
	createdAt: Date;
	id: string;
};

type SecurityAuditHistoryRow = {
	id: string;
	organizationId: string;
	actorUserId: string;
	action: "session.revoke" | "session.revoke_others" | "mailbox.grant_bulk" |
		"mcp.authorize" | "mcp.revoke" | "mcp.mutate" |
		"push.register" | "push.rename" | "push.preferences" | "push.revoke";
	resourceType: "session" | "mailbox_membership" | "mcp_connection" | "push_device";
	resourceId: string | null;
	affectedCount: number;
	requestId: string;
	outcome: "succeeded";
	createdAt: Date;
};

export type SecurityAuditHistory = ReturnType<typeof buildSecurityAuditHistory>;

export function encodeSecurityEventCursor(cursor: SecurityEventCursor): string {
	return `m${cursor.createdAt.getTime().toString(36)}.${cursor.id}`;
}

export function decodeSecurityEventCursor(value: string): SecurityEventCursor | null {
	const match = /^m([0-9a-z]+)\.([A-Za-z0-9_-]+)$/.exec(value);
	if (!match) return null;
	const milliseconds = Number.parseInt(match[1], 36);
	if (!Number.isSafeInteger(milliseconds)) return null;
	const createdAt = new Date(milliseconds);
	if (Number.isNaN(createdAt.getTime())) return null;
	return { createdAt, id: match[2] };
}

export function buildSecurityAuditHistory(
	organizationId: string,
	limit: number,
	rows: readonly SecurityAuditHistoryRow[],
) {
	const scoped = rows.filter((row) => row.organizationId === organizationId);
	const page = scoped.slice(0, limit);
	const events = page.map((row) => ({
		id: row.id,
		actorUserId: row.actorUserId,
		action: row.action,
		resourceType: row.resourceType,
		resourceId: row.resourceId,
		affectedCount: row.affectedCount,
		requestId: row.requestId,
		outcome: row.outcome,
		createdAt: row.createdAt.toISOString(),
	}));
	const last = page.at(-1);
	return {
		events,
		nextCursor: scoped.length > limit && last
			? encodeSecurityEventCursor({ createdAt: last.createdAt, id: last.id })
			: null,
	};
}

export async function readSecurityAuditHistory(
	env: CloudflareEnv,
	organizationId: string,
	options: { limit: number; cursor: SecurityEventCursor | null },
): Promise<SecurityAuditHistory> {
	return readSecurityAuditHistoryFromDb(getDb(env), organizationId, options);
}

export async function readSecurityAuditHistoryFromDb(
	db: AppDatabase,
	organizationId: string,
	options: { limit: number; cursor: SecurityEventCursor | null },
): Promise<SecurityAuditHistory> {
	const limit = Math.min(Math.max(options.limit, 1), SECURITY_EVENT_MAX_LIMIT);
	const boundary = options.cursor
		? or(
			lt(securityAuditEvents.createdAt, options.cursor.createdAt),
			and(
				eq(securityAuditEvents.createdAt, options.cursor.createdAt),
				lt(securityAuditEvents.id, options.cursor.id),
			),
		)
		: undefined;
	const rows = await db
		.select({
			id: securityAuditEvents.id,
			organizationId: securityAuditEvents.organizationId,
			actorUserId: securityAuditEvents.actorUserId,
			action: securityAuditEvents.action,
			resourceType: securityAuditEvents.resourceType,
			resourceId: securityAuditEvents.resourceId,
			affectedCount: securityAuditEvents.affectedCount,
			requestId: securityAuditEvents.requestId,
			outcome: securityAuditEvents.outcome,
			createdAt: securityAuditEvents.createdAt,
		})
		.from(securityAuditEvents)
		.where(and(eq(securityAuditEvents.organizationId, organizationId), boundary))
		.orderBy(desc(securityAuditEvents.createdAt), desc(securityAuditEvents.id))
		.limit(limit + 1);

	return buildSecurityAuditHistory(organizationId, limit, rows);
}
