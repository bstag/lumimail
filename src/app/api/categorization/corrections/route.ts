import { withUser } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/response";
import { categorizationCorrectionSchema } from "@/lib/validators";
import { correctMessage } from "@/lib/categorization/service";
import { categorizationResponse } from "@/lib/categorization/response";
export const POST = withUser(async ({ env, user, request }) => {
	const { data, errorResponse } = await parseJsonBody(
		request,
		categorizationCorrectionSchema,
	);
	if (errorResponse) return errorResponse;
	return categorizationResponse(() =>
		correctMessage(env, user, data.messageId, data.tags),
	);
});
