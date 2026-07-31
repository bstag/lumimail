import { withOrgAdmin } from "@/lib/api/handler";
import { getDomainDns, getDomainForUser } from "@/lib/domains/service";
import { apiSuccess, apiError } from "@/lib/api/response";

export const GET = withOrgAdmin<{ id: string }>(async ({ env, user, params }) => {
	const domain = await getDomainForUser(env, user.organizationId, params.id);
	if (!domain) return apiError("Not found", 404);

	try {
		const dns = await getDomainDns(env, domain);
		return apiSuccess({ domain, dns });
	} catch {
		return apiError("Failed to fetch DNS", 500);
	}
});
