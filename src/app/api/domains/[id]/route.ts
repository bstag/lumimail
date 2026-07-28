import { getEnv } from "@/lib/cloudflare";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { getDomainForUser, removeDomainForUser } from "@/lib/domains/service";
import { apiSuccess, apiError } from "@/lib/api/response";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;
	const domain = await getDomainForUser(env, orgUser.organizationId!, id);
	if (!domain) return apiError("Not found", 404);
	return apiSuccess({ domain });
}

export async function DELETE(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;
	try {
		await removeDomainForUser(env, orgUser.organizationId!, id);
		return apiSuccess({ ok: true });
	} catch {
		return apiError("Failed to remove domain", 400);
	}
}
