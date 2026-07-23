import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { guardUser } from "@/lib/auth/cookies";
import { getDomainForUser, removeDomainForUser } from "@/lib/domains/service";
import { apiSuccess, apiError } from "@/lib/api/response";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	if (!user.organizationId) return apiError("No organization", 400);
	const domain = await getDomainForUser(env, user.organizationId, id);
	if (!domain) return apiError("Not found", 404);
	return apiSuccess({ domain });
}

export async function DELETE(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	try {
		await removeDomainForUser(env, user.organizationId!, id);
		return apiSuccess({ ok: true });
	} catch {
		return apiError("Failed to remove domain", 400);
	}
}
