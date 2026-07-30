import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { withUser } from "@/lib/api/handler";
import { z } from "zod";

const changePasswordSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(8),
});

export const POST = withUser(async ({ request, env, user }) => {
	const body = await request.json() as Record<string, unknown>;
	const parsed = changePasswordSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	}

	const db = getDb(env);
	const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
	if (!dbUser || !verifyPassword(parsed.data.currentPassword, dbUser.passwordHash)) {
		return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
	}

	const newHash = hashPassword(parsed.data.newPassword);
	await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

	return NextResponse.json({ ok: true });
});
