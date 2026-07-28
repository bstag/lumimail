import { getEnv } from "@/lib/cloudflare";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { getDomainDns, getDomainForUser } from "@/lib/domains/service";
import { apiSuccess, apiError } from "@/lib/api/response";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;
	const domain = await getDomainForUser(env, orgUser.organizationId!, id);
	if (!domain) return apiError("Not found", 404);

	try {
		const dns = await getDomainDns(env, domain);
		return apiSuccess({ domain, dns });
	} catch {
		return apiError("Failed to fetch DNS", 500);
	}
}
