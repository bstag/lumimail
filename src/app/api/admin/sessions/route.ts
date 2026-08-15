import { cookies } from "next/headers";
import { withOrgOwner } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getBearerToken } from "@/lib/auth/cookies";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { readSessionOverview } from "@/lib/session-overview";

export const GET = withOrgOwner(async ({ request, env, user }) => {
	const bearerToken = getBearerToken(request);
	const cookieToken = bearerToken ? undefined : (await cookies()).get(SESSION_COOKIE)?.value;
	return apiSuccess(await readSessionOverview(
		env,
		user.organizationId,
		bearerToken ?? cookieToken,
	));
});
