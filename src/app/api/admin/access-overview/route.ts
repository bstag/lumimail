import { withOrgAdmin } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { readAccessOverview } from "@/lib/access-overview";

export const GET = withOrgAdmin(async ({ env, user }) => {
	return apiSuccess(await readAccessOverview(env, user.organizationId));
});
