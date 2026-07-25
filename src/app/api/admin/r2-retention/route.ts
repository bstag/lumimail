import { guardOrgOwner } from "@/lib/auth/org-guard";
import { getEnv } from "@/lib/cloudflare";
import { apiError, apiSuccess } from "@/lib/api/response";
import { deleteR2Orphans, reportR2Retention } from "@/lib/r2-retention";

export async function GET(request: Request) {
	const env = getEnv();
	const { errorResponse } = await guardOrgOwner(env, request);
	if (errorResponse) return errorResponse;

	return apiSuccess(await reportR2Retention(env));
}

export async function POST(request: Request) {
	const env = getEnv();
	const { errorResponse } = await guardOrgOwner(env, request);
	if (errorResponse) return errorResponse;

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
}
