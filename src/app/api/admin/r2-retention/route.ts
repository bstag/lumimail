import { withOrgOwner } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { isInstanceOperator } from "@/lib/auth/instance-operator";
import { deleteR2Orphans, reportR2Retention } from "@/lib/r2-retention";

export const GET = withOrgOwner(async ({ env, user }) => {
	if (!isInstanceOperator(env, user.id)) return apiError("Forbidden", 403);
	return apiSuccess(await reportR2Retention(env));
});

export const POST = withOrgOwner(async ({ request, env, user }) => {
	if (!isInstanceOperator(env, user.id)) return apiError("Forbidden", 403);
	const body = (await request.json().catch(() => null)) as
		| { confirm?: unknown; limit?: unknown }
		| null;

	// Deletion is irreversible, so it requires the exact confirmation string rather
	// than any truthy flag.
	if (body?.confirm !== "delete") {
		return apiError("Send { confirm: \"delete\" } to remove reported orphans", 400);
	}

	const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : undefined;
	return apiSuccess(await deleteR2Orphans(env, { limit }));
});
