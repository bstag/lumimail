import { withOrgOwner } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { readOperationsOverview } from "@/lib/operations";

export const GET = withOrgOwner(async ({ env }) => {
	return apiSuccess(await readOperationsOverview(env));
});
