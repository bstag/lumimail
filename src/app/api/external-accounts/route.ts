import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { listExternalAccounts } from "@/lib/email/external/account-management";

export const GET = withUser(async ({ env, user }) => {
	if (!user.organizationId) return apiError("No active organization", 403);
	return apiSuccess({
		accounts: await listExternalAccounts(env, user.id, user.organizationId),
	});
});
