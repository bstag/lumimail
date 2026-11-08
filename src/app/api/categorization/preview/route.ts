import { withUser } from "@/lib/api/handler";
import { apiError, parseJsonBody } from "@/lib/api/response";
import { previewCategorizationSchema } from "@/lib/validators";
import {
	CategorizationError,
	previewConfiguration,
} from "@/lib/categorization/service";
import { categorizationResponse } from "@/lib/categorization/response";
import { enforceRateLimit, rateLimitUser } from "@/lib/rate-limit";
export const POST = withUser(async ({ env, user, request }) => {
	const { data, errorResponse } = await parseJsonBody(
		request,
		previewCategorizationSchema,
	);
	if (errorResponse) return errorResponse;
	return categorizationResponse(async () => {
		const limited = await enforceRateLimit(
			rateLimitUser(env, user.id, "categorization-preview", 5, 60000),
			{
				respond: apiError,
				unavailableLog: "Categorization preview limiter unavailable",
				limitedMessage: "Wait a minute before testing more samples",
			},
		);
		if (limited) {
			// Keep the normal response status; rate-limit failures are not successful data.
			throw new CategorizationError(
				limited.status === 429
					? "Wait a minute before testing more samples"
					: "Service temporarily unavailable",
				limited.status,
			);
		}
		return previewConfiguration(env, user, data);
	});
});
