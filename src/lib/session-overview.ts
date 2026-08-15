import { and, eq, gt } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { organizationMembers, sessions, users } from "@/db/schema";
import { lookupSessionToken } from "@/lib/auth/session";

type SessionOverviewRow = {
	id: string;
	userId: string;
	name: string;
	email: string;
	sessionOrganizationId: string | null;
	memberOrganizationId: string;
	tokenLookup: string;
	createdAt: Date;
	expiresAt: Date;
};

export type SessionOverview = ReturnType<typeof buildSessionOverview>;

export function buildSessionOverview(
	organizationId: string,
	currentTokenLookup: string | null,
	now: Date,
	rows: readonly SessionOverviewRow[],
) {
	const activeSessions = rows
		.filter((row) =>
			row.sessionOrganizationId === organizationId &&
			row.memberOrganizationId === organizationId &&
			row.expiresAt.getTime() > now.getTime())
		.map((row) => ({
			id: row.id,
			userId: row.userId,
			name: row.name,
			email: row.email,
			createdAt: row.createdAt.toISOString(),
			expiresAt: row.expiresAt.toISOString(),
			isCurrent: currentTokenLookup !== null && row.tokenLookup === currentTokenLookup,
		}))
		.sort((a, b) =>
			Number(b.isCurrent) - Number(a.isCurrent) ||
			new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
			a.id.localeCompare(b.id));

	return {
		observedAt: now.toISOString(),
		activeCount: activeSessions.length,
		sessions: activeSessions,
	};
}

export async function readSessionOverview(
	env: CloudflareEnv,
	organizationId: string,
	currentToken: string | undefined,
	now = new Date(),
): Promise<SessionOverview> {
	const currentTokenLookup = currentToken ? await lookupSessionToken(currentToken) : null;
	return readSessionOverviewFromDb(getDb(env), organizationId, currentTokenLookup, now);
}

export async function readSessionOverviewFromDb(
	db: AppDatabase,
	organizationId: string,
	currentTokenLookup: string | null,
	now: Date,
): Promise<SessionOverview> {
	const rows = await db
		.select({
			id: sessions.id,
			userId: sessions.userId,
			name: users.name,
			email: users.email,
			sessionOrganizationId: sessions.organizationId,
			memberOrganizationId: organizationMembers.organizationId,
			tokenLookup: sessions.tokenLookup,
			createdAt: sessions.createdAt,
			expiresAt: sessions.expiresAt,
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.innerJoin(
			organizationMembers,
			and(
				eq(organizationMembers.userId, sessions.userId),
				eq(organizationMembers.organizationId, organizationId),
			),
		)
		.where(and(
			eq(sessions.organizationId, organizationId),
			gt(sessions.expiresAt, now),
		));

	return buildSessionOverview(organizationId, currentTokenLookup, now, rows);
}
