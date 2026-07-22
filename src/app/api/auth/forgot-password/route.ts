import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import {
	buildPasswordResetLink,
	hashPasswordResetToken,
	sendPasswordResetEmail,
} from "@/lib/auth/password-reset";
import { newId } from "@/lib/ids";
import { apiError, apiSuccess } from "@/lib/api/response";
import { forgotPasswordSchema } from "@/lib/validators";

const genericResponse = {
	message: "If the account exists, a reset link has been sent.",
};

export async function POST(request: Request) {
	const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return apiError("A valid email is required", 400);

	const env = getEnv();
	const db = getDb(env);
	const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);

	if (!user?.resetEmail) return apiSuccess(genericResponse);

	const token = newId("pwr");
	const tokenId = newId();
	let tokenStored = false;
	try {
		const tokenHash = await hashPasswordResetToken(token);
		await db.insert(passwordResetTokens).values({
			id: tokenId,
			userId: user.id,
			tokenHash,
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
			used: false,
		});
		tokenStored = true;

		const resetLink = buildPasswordResetLink(env.PUBLIC_APP_URL ?? "", token, parsed.data.email);
		await sendPasswordResetEmail(env, user.resetEmail, resetLink);
	} catch {
		if (tokenStored) {
			try {
				await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, tokenId));
			} catch {
				// The delivery failure remains non-enumerating even if cleanup also fails.
			}
		}
		console.error("Password reset email delivery failed");
	}

	return apiSuccess(genericResponse);
}
