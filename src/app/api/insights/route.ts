import { withUser } from "@/lib/api/handler";
import { apiError } from "@/lib/api/response";
import { mailInsightsQuerySchema } from "@/lib/validators";
import { readInsights } from "@/lib/categorization/service";
import { categorizationResponse } from "@/lib/categorization/response";
export const GET = withUser(async ({ env, user, request }) => {
	const parsed = mailInsightsQuerySchema.safeParse(
		Object.fromEntries(new URL(request.url).searchParams),
	);
	if (!parsed.success) return apiError("Invalid insights query", 400);
	return categorizationResponse(() => readInsights(env, user, parsed.data));
});
