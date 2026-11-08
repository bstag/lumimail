import { withUser } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/response";
import { activateCategorizationSchema } from "@/lib/validators";
import {
	readConfiguration,
	activateConfiguration,
} from "@/lib/categorization/service";
import { categorizationResponse } from "@/lib/categorization/response";
export const GET = withUser(async ({ env, user }) =>
	categorizationResponse(() => readConfiguration(env, user)),
);
export const POST = withUser(async ({ env, user, request }) => {
	const { data, errorResponse } = await parseJsonBody(
		request,
		activateCategorizationSchema,
	);
	if (errorResponse) return errorResponse;
	return categorizationResponse(() => activateConfiguration(env, user, data));
});
