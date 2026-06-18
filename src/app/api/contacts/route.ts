import { NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { guardUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { contacts } from "@/db/schema";
import { normalizeEmailAddress } from "@/lib/email/address";
import { getContactId } from "@/lib/contacts/utils";
import { apiSuccess, apiError } from "@/lib/api/response";

const createContactSchema = z.object({
	email: z.string().email(),
	displayName: z.string().min(1).max(200).optional(),
});

export async function GET(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const rows = await db
		.select()
		.from(contacts)
		.where(eq(contacts.userId, user.id))
		.orderBy(desc(contacts.lastSeenAt))
		.limit(100);

	return apiSuccess(rows);
}

export async function POST(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError("Invalid JSON", 400);
	}

	const parsed = createContactSchema.safeParse(body);
	if (!parsed.success) {
		/* v8 ignore next -- a Zod failure always carries an issue; the ?? fallback is defensive */
		return apiError(parsed.error.issues[0]?.message ?? "Invalid input", 400);
	}

	const email = normalizeEmailAddress(parsed.data.email);
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
				displayName: parsed.data.displayName ?? existing.displayName,
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
			displayName: parsed.data.displayName ?? null,
			source: "manual",
			lastSeenAt: new Date(),
		})
		.returning();

	return NextResponse.json({ success: true, data: created }, { status: 201 });
}
