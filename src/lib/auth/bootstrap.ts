import type { users } from "@/db/schema";

type FirstUser = Pick<typeof users.$inferInsert, "id" | "email" | "resetEmail" | "passwordHash" | "name">;

/** The insert is the first-owner claim, so concurrent requests cannot both provision. */
export async function claimFirstRunUser(env: Pick<CloudflareEnv, "DB">, user: FirstUser): Promise<boolean> {
	const row = await env.DB.prepare(`
		INSERT INTO users (id, email, reset_email, password_hash, name, organization_id, created_at)
		SELECT ?, ?, ?, ?, ?, NULL, unixepoch()
		WHERE NOT EXISTS (SELECT 1 FROM users)
		  AND NOT EXISTS (SELECT 1 FROM domains)
		RETURNING id
	`).bind(user.id, user.email, user.resetEmail ?? null, user.passwordHash, user.name).first<{ id: string }>();
	return row !== null;
}
