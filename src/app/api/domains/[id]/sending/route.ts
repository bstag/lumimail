import { z } from "zod";
import { guardUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getDomainForUser, reconcileDomainSending } from "@/lib/domains/service";
import { apiError, apiSuccess } from "@/lib/api/response";

const requestSchema = z.object({ action: z.enum(["verify", "enable"]) });
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;
	if (!user.organizationId) return apiError("No organization", 400);

	const { id } = await params;
	const domain = await getDomainForUser(env, user.organizationId, id);
	if (!domain) return apiError("Not found", 404);

	const body = await request.json().catch(() => null);
	const parsed = requestSchema.safeParse(body);
	if (!parsed.success) return apiError("Invalid sending action", 400, parsed.error.flatten());

	try {
		return apiSuccess(await reconcileDomainSending(env, domain, parsed.data.action));
	} catch {
		return apiError("Cloudflare could not verify Email Sending", 400);
	}
}
