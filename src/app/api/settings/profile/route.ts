import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/response";
import { updateProfileSchema } from "@/lib/validators";

export const PATCH = withUser(async ({ request, env, user }) => {
	const { data, errorResponse } = await parseJsonBody(request, updateProfileSchema);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	await db
		.update(users)
		.set({
			name: data.name,
			resetEmail: data.resetEmail,
		})
		.where(eq(users.id, user.id));

	return NextResponse.json({
		user: {
			id: user.id,
			email: user.email,
			name: data.name,
			resetEmail: data.resetEmail,
		},
	});
});
