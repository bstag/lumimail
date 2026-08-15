import type { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { newId } from "@/lib/ids";
import { sha256Hex } from "@/lib/crypto-utils";
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

/**
 * Digest used to locate a session row in one indexed lookup (F66).
 *
 * Authentication still depends on the bcrypt comparison against `tokenHash`; this
 * only replaces scanning every unexpired session. SHA-256 is appropriate because a
 * session token is high-entropy random material, not a user-chosen password.
 */
export async function lookupSessionToken(token: string): Promise<string> {
	return sha256Hex(token);
}

export async function createSession(env: CloudflareEnv, userId: string): Promise<string> {
	const db = getDb(env);
	const [user] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1);
	const token = generateSessionToken();
	const tokenHash = hashSessionToken(token);
	const tokenLookup = await lookupSessionToken(token);
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
	const authenticatedAt = new Date();

	await db.insert(sessions).values({
		id: newId(),
		userId,
		tokenLookup,
		tokenHash,
		expiresAt,
		authenticatedAt,
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
	const membership = await getActiveOrgMembership(env, user);
	if (membership) return { ...user, role: membership.role };
	return user;
}

export type ActiveOrgMembership = {
	organizationId: string;
	role: string | null;
};

/**
 * Resolve a user's active organization membership (T-41).
 *
 * Invariant: organization membership is stored twice today —
 * `users.organizationId` is the *active-org pointer* (which workspace the user
 * currently acts in), while the `organizationMembers` join table is the *role
 * truth* (whether, and as what, the user belongs to that org). Any code that
 * needs "which org and what role" must read both, and must do it through this
 * accessor rather than touching the column directly, so retiring the column
 * (a post-batch migration; deliberately out of this batch's scope) only has
 * one call site to rewrite.
 *
 * Current behavior when the two disagree — the pointer names an org with no
 * matching `organizationMembers` row — is preserved deliberately: the user is
 * still scoped to that org but with `role: null`, so every role-gated guard
 * (org admin/owner) denies. This is asserted by a consistency test.
 */
export async function getActiveOrgMembership(
	env: CloudflareEnv,
	user: { id: string; organizationId: string | null },
): Promise<ActiveOrgMembership | null> {
	if (!user.organizationId) return null;
	const db = getDb(env);
	const [membership] = await db
		.select({ role: organizationMembers.role })
		.from(organizationMembers)
		.where(and(
			eq(organizationMembers.userId, user.id),
			eq(organizationMembers.organizationId, user.organizationId),
		))
		.limit(1);
	return { organizationId: user.organizationId, role: membership?.role ?? null };
}

/**
 * Attaches the session cookie to a response with the canonical attributes
 * (httpOnly, secure, lax, site-wide, expiry matching SESSION_DAYS). Login and
 * registration must set byte-identical cookies, so the literal lives here.
 */
export function setSessionCookie(response: NextResponse, token: string): void {
	response.cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * SESSION_DAYS,
	});
}

export async function deleteSession(env: CloudflareEnv, token: string): Promise<void> {
	const db = getDb(env);
	// Deleting by digest is idempotent and needs no bcrypt: possessing the token is
	// what is being proven, and removing a session is not an authorization decision.
	await db
		.delete(sessions)
		.where(eq(sessions.tokenLookup, await lookupSessionToken(token)));
}
