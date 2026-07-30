import { and, eq, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { newId } from "@/lib/ids";
import { getDb } from "@/db";
import { sessions, users, organizationMembers } from "@/db/schema";

export const SESSION_COOKIE = "ep_session";
const SESSION_DAYS = 30;

export function generateSessionToken(): string {
	return newId("sess");
}

export function hashSessionToken(token: string): string {
	return bcrypt.hashSync(token, 10);
}

export function verifySessionToken(token: string, hash: string): boolean {
	return bcrypt.compareSync(token, hash);
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Digest used to locate a session row in one indexed lookup (F66).
 *
 * Authentication still depends on the bcrypt comparison against `tokenHash`; this
 * only replaces scanning every unexpired session. SHA-256 is appropriate because a
 * session token is high-entropy random material, not a user-chosen password.
 */
export async function lookupSessionToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return bytesToHex(new Uint8Array(digest));
}

export async function createSession(env: CloudflareEnv, userId: string): Promise<string> {
	const db = getDb(env);
	const [user] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1);
	const token = generateSessionToken();
	const tokenHash = hashSessionToken(token);
	const tokenLookup = await lookupSessionToken(token);
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

	await db.insert(sessions).values({
		id: newId(),
		userId,
		tokenLookup,
		tokenHash,
		expiresAt,
		organizationId: user?.organizationId ?? null,
	});

	return token;
}

export type SessionUser = typeof users.$inferSelect & { role?: string | null };

export async function getUserFromSession(
	env: CloudflareEnv,
	token: string | undefined,
): Promise<SessionUser | null> {
	if (!token) return null;
	const db = getDb(env);
	// One indexed lookup, then a single bcrypt comparison. A token matching no row
	// costs no bcrypt at all.
	const [row] = await db
		.select()
		.from(sessions)
		.where(and(
			eq(sessions.tokenLookup, await lookupSessionToken(token)),
			gt(sessions.expiresAt, new Date()),
		))
		.limit(1);

	if (!row || !verifySessionToken(token, row.tokenHash)) return null;

	const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
	if (!user) return null;
	if (user.organizationId) {
		const [membership] = await db
			.select({ role: organizationMembers.role })
			.from(organizationMembers)
			.where(and(
				eq(organizationMembers.userId, user.id),
				eq(organizationMembers.organizationId, user.organizationId),
			))
			.limit(1);
		return { ...user, role: membership?.role ?? null };
	}
	return user;
}

export async function deleteSession(env: CloudflareEnv, token: string): Promise<void> {
	const db = getDb(env);
	// Deleting by digest is idempotent and needs no bcrypt: possessing the token is
	// what is being proven, and removing a session is not an authorization decision.
	await db
		.delete(sessions)
		.where(eq(sessions.tokenLookup, await lookupSessionToken(token)));
}
