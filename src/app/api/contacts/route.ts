import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { normalizeEmailAddress } from "@/lib/email/address";
import { getContactId } from "@/lib/contacts/utils";
import { apiSuccess, apiError, parseJsonBody } from "@/lib/api/response";
import { createContactSchema } from "@/lib/validators";

export const GET = withUser(async ({ env, user }) => {
	const db = getDb(env);
	const rows = await db
		.select()
		.from(contacts)
		.where(eq(contacts.userId, user.id))
		.orderBy(desc(contacts.lastSeenAt))
		.limit(100);

	return apiSuccess(rows);
});

export const POST = withUser(async ({ request, env, user }) => {
	const { data, errorResponse } = await parseJsonBody(request, createContactSchema);
	if (errorResponse) return errorResponse;

	const email = normalizeEmailAddress(data.email);
	if (!email) return apiError("Invalid email address", 400);

	const db = getDb(env);

	const [existing] = await db
		.select()
		.from(contacts)
		.where(and(eq(contacts.userId, user.id), eq(contacts.email, email)))
		.limit(1);

	if (existing) {
		const [updated] = await db
			.update(contacts)
			.set({
				displayName: data.displayName ?? existing.displayName,
				source: "manual",
				lastSeenAt: new Date(),
			})
			.where(eq(contacts.id, existing.id))
			.returning();
		return apiSuccess(updated);
	}

	const id = getContactId(user.id, email);
	const [created] = await db
		.insert(contacts)
		.values({
			id,
			userId: user.id,
			email,
			displayName: data.displayName ?? null,
			source: "manual",
			lastSeenAt: new Date(),
		})
		.returning();

	return apiSuccess(created, 201);
});
