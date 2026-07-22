import { and, eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { passwordResetTokens, sessions, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { hashPasswordResetToken } from "@/lib/auth/password-reset";
import { apiError, apiSuccess } from "@/lib/api/response";
import { resetPasswordSchema } from "@/lib/validators";

const invalidToken = () => apiError("Invalid or expired token", 400);

export async function POST(request: Request) {
	const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return apiError("Invalid request", 400);

	const env = getEnv();
	const db = getDb(env);
	const tokenHash = await hashPasswordResetToken(parsed.data.token);
	const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
	if (!user) return invalidToken();

	const [token] = await db
		.select()
		.from(passwordResetTokens)
		.where(
			and(
				eq(passwordResetTokens.userId, user.id),
				eq(passwordResetTokens.tokenHash, tokenHash),
				eq(passwordResetTokens.used, false),
			),
		)
		.limit(1);
	if (!token || token.expiresAt <= new Date()) return invalidToken();

	const [claimedToken] = await db
		.update(passwordResetTokens)
		.set({ used: true })
		.where(and(eq(passwordResetTokens.id, token.id), eq(passwordResetTokens.used, false)))
		.returning({ id: passwordResetTokens.id });
	if (!claimedToken) return invalidToken();

	await db
		.update(users)
		.set({ passwordHash: hashPassword(parsed.data.newPassword) })
		.where(eq(users.id, user.id));
	await db
		.update(passwordResetTokens)
		.set({ used: true })
		.where(and(eq(passwordResetTokens.userId, user.id), eq(passwordResetTokens.used, false)));
	await db.delete(sessions).where(eq(sessions.userId, user.id));

	return apiSuccess({ ok: true });
}
