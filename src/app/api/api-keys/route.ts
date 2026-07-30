import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { apiKeys } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/response";
import { generateApiKey, scopesToJson } from "@/lib/api-keys";
import { newId } from "@/lib/ids";

const createKeySchema = z.object({
	name: z.string().min(1),
	scopes: z.array(z.enum(["send", "read"])).min(1),
});

export const GET = withUser(async ({ env, user }) => {
	const db = getDb(env);
	const rows = await db
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			prefix: apiKeys.prefix,
			scopes: apiKeys.scopes,
			createdAt: apiKeys.createdAt,
			lastUsedAt: apiKeys.lastUsedAt,
			revokedAt: apiKeys.revokedAt,
		})
		.from(apiKeys)
		.where(eq(apiKeys.userId, user.id));
	return NextResponse.json({ apiKeys: rows });
});

export const POST = withUser(async ({ request, env, user }) => {
	const { data, errorResponse } = await parseJsonBody(request, createKeySchema);
	if (errorResponse) return errorResponse;

	const { fullKey, prefix, hash } = generateApiKey();
	const db = getDb(env);
	const id = newId("key");
	await db.insert(apiKeys).values({
		id,
		userId: user.id,
		name: data.name,
		prefix,
		keyHash: hash,
		scopes: scopesToJson(data.scopes),
	});

	return NextResponse.json({ id, name: data.name, prefix, key: fullKey });
});
