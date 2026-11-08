import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageFilters } from "@/db/schema";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { applyFilterToExisting } from "@/lib/email/message-filters";

type Context = Parameters<Parameters<typeof withUser<{ id: string }>>[0]>[0];

/** Counts (GET) or changes (POST) the existing mail one of the user's filters matches (F101). */
async function run({ env, user, params }: Context, preview: boolean) {
	const db = getDb(env);
	const [filter] = await db.select().from(messageFilters)
		.where(and(eq(messageFilters.id, params.id), eq(messageFilters.userId, user.id)))
		.limit(1);
	if (!filter) return apiError("Filter not found", 404);
	return apiSuccess(await applyFilterToExisting(db, user, filter, { preview }));
}

export const GET = withUser<{ id: string }>((context) => run(context, true));
export const POST = withUser<{ id: string }>((context) => run(context, false));
