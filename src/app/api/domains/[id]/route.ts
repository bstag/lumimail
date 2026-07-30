import { withOrgAdmin } from "@/lib/api/handler";
import { getDomainForUser, removeDomainForUser } from "@/lib/domains/service";
import { apiSuccess, apiError } from "@/lib/api/response";

export const GET = withOrgAdmin<{ id: string }>(async ({ env, user, params }) => {
	const domain = await getDomainForUser(env, user.organizationId, params.id);
	if (!domain) return apiError("Not found", 404);
	return apiSuccess({ domain });
});

export const DELETE = withOrgAdmin<{ id: string }>(async ({ env, user, params }) => {
	try {
		await removeDomainForUser(env, user.organizationId, params.id);
		return apiSuccess({ ok: true });
	} catch {
		return apiError("Failed to remove domain", 400);
	}
});
