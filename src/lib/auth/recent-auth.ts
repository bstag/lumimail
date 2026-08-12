import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { lookupSessionToken } from "@/lib/auth/session";

export const RECENT_AUTH_WINDOW_MS = 15 * 60 * 1000;

export type ReconfirmSessionResult =
	| { confirmed: false }
	| { confirmed: true; recentUntil: Date };

export type RecentlyAuthenticatedSession = {
	id: string;
	organizationId: string | null;
	tokenLookup: string;
};

export async function reconfirmSession(
	env: CloudflareEnv,
	userId: string,
	token: string | undefined,
	password: string,
	now = new Date(),
): Promise<ReconfirmSessionResult> {
	if (!token) return { confirmed: false };
	const db = getDb(env);
	const [user] = await db
		.select({ passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!user || !verifyPassword(password, user.passwordHash)) return { confirmed: false };

	const updated = await db
		.update(sessions)
		.set({ authenticatedAt: now })
		.where(and(
			eq(sessions.userId, userId),
			eq(sessions.tokenLookup, await lookupSessionToken(token)),
			gt(sessions.expiresAt, now),
		))
		.returning({ id: sessions.id });
	if (updated.length !== 1) return { confirmed: false };

	return {
		confirmed: true,
		recentUntil: new Date(now.getTime() + RECENT_AUTH_WINDOW_MS),
	};
}

export async function isSessionRecentlyAuthenticated(
	env: CloudflareEnv,
	userId: string,
	token: string | undefined,
	now = new Date(),
): Promise<boolean> {
	return (await readRecentlyAuthenticatedSession(env, userId, token, now)) !== null;
}

export async function readRecentlyAuthenticatedSession(
	env: CloudflareEnv,
	userId: string,
	token: string | undefined,
	now = new Date(),
): Promise<RecentlyAuthenticatedSession | null> {
	if (!token) return null;
	const db = getDb(env);
	const [session] = await db
		.select({
			id: sessions.id,
			organizationId: sessions.organizationId,
			tokenLookup: sessions.tokenLookup,
			authenticatedAt: sessions.authenticatedAt,
		})
		.from(sessions)
		.where(and(
			eq(sessions.userId, userId),
			eq(sessions.tokenLookup, await lookupSessionToken(token)),
			gt(sessions.expiresAt, now),
		))
		.limit(1);
	if (!session?.authenticatedAt) return null;

	const authenticatedAt = session.authenticatedAt.getTime();
	if (authenticatedAt > now.getTime() ||
		authenticatedAt < now.getTime() - RECENT_AUTH_WINDOW_MS) return null;
	return {
		id: session.id,
		organizationId: session.organizationId,
		tokenLookup: session.tokenLookup,
	};
}
